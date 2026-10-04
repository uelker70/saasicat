import { Inject, Injectable, Optional, UnprocessableEntityException } from '@nestjs/common';
import type {
    BillingCycle,
    CheckoutOfferPromoCodeSnapshot,
    CreateSubscriptionContractData,
    SubscriptionContractPriceSnapshot,
    SubscriptionContractRecord,
    SubscriptionUsagePort,
    TenantSubscriptionWritePort,
} from '@saasicat/core';

import { EntitlementService } from '../entitlement/entitlement.service.js';
import { ENTITLEMENT_SERVICE_TOKEN } from '../entitlement/entitlement.tokens.js';
import {
    contractChanged,
    SUCCESSOR_ATTEMPTS,
    SubscriptionContractService,
    type IntendedContract,
} from '../subscription-contract/subscription-contract.service.js';
import { PLAN_CATALOG_SOURCE_TOKEN } from './plan-catalog.module.js';
import type { PlanCatalogSource } from './plan-catalog-source.js';
import {
    SUBSCRIPTION_USAGE_PORT_TOKEN,
    SUBSCRIPTION_WRITE_PORT_TOKEN,
} from './tenant-billing.tokens.js';
import { generatedDiscountLine } from '../checkout-offer/discount-line-items.js';
import { buildLabel, promoCodeDiscountNet } from '../promo/calculator.js';
import { PromoCodesService } from '../promo/promo.service.js';
import {
    planDefOfVersion,
    isPlanNotSoldInCycle,
    listPriceNet,
    planNotSoldInCycle,
} from './plan-helpers.js';
import {
    CONTRACT_FREEZE_SOURCE_PORT_TOKEN,
    type ContractFreezePort,
    type ContractFreezeSourcePort,
    type RetirementContractTerms,
} from './contract-freeze.tokens.js';
import {
    contractTotalsOf,
    type PricedContractLineItem,
    recordContractLinesMoney,
} from '../subscription-contract/contract-line-item-money.js';
import {
    assertContractWindow,
    assertNoNegativeDiscount,
    assertOnePlanLine,
    assertTaxRatePercent,
} from '../subscription-contract/contract-refusals.js';
import { contractTaxPeriod, rateOfTheFile } from '../tax/tax-treatments.js';

// SubscriptionContractFreezeService (#18) — on a plan change, freezes the
// agreed service as a `SubscriptionContract` with `entitlementSnapshot`.
// The `EntitlementService` reads the active contract FIRST → from the change
// onward the tenant's entitlements are catalog-independent (AdminUI edits/deletes
// no longer touch the running plan), and the change is documented audit-safely
// via the frozen line items + prices.
//
// Generic: uses EntitlementService + SubscriptionContractService + PlanCatalogSource.
// Consumer-specific is only the bundle/version data access
// (`ContractFreezeSourcePort`).

@Injectable()
export class SubscriptionContractFreezeService implements ContractFreezePort {
    constructor(
        @Inject(PLAN_CATALOG_SOURCE_TOKEN) private readonly catalogs: PlanCatalogSource,
        // tsup build has no emitDecoratorMetadata — class type args explicitly @Inject.
        @Inject(ENTITLEMENT_SERVICE_TOKEN) private readonly entitlements: EntitlementService,
        @Inject(SubscriptionContractService)
        private readonly contracts: SubscriptionContractService,
        @Inject(CONTRACT_FREEZE_SOURCE_PORT_TOKEN)
        private readonly source: ContractFreezeSourcePort,
        @Optional()
        @Inject(SUBSCRIPTION_WRITE_PORT_TOKEN)
        writes: TenantSubscriptionWritePort | null = null,
        // Both optional: without the promo module nothing is redeemed, and the
        // subscription is how a redemption is found.
        @Optional()
        @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN)
        private readonly subscriptions: SubscriptionUsagePort | null = null,
        @Optional()
        @Inject(PromoCodesService)
        private readonly promoCodes: PromoCodesService | null = null,
    ) {
        // Said once, at start. A write that does not bind is wrong for every
        // tenant at once, and each freeze would refuse on its own — caught and
        // logged by its caller, while the tenant who paid for an upgrade stays
        // under the contract they left.
        if (writes?.bindsPlanVersion === false) {
            throw new Error(
                'The contract freeze records the plan version a subscription is bound to, and ' +
                    "this installation's subscription write does not bind it on a plan change. " +
                    'With @saasicat/adapter-prisma, leave `tenantSubscription.synchronizePlanVersion` ' +
                    'at its default of true — or do not configure `contractFreeze`.',
            );
        }
    }

    assertPartyFor(tenantId: string, intended: IntendedContract): Promise<void> {
        return this.contracts.assertPartyFor(tenantId, intended);
    }

    async endOnCancellation(tenantId: string, effectiveAt: Date): Promise<void> {
        // The contract ends when the subscription does, and nothing replaces
        // it. `findActiveByTenantId` is asked as of the effective date rather
        // than now, so a cancellation recorded ahead of time ends the contract
        // that is running at that moment rather than whichever one is running
        // when the write happens.
        const active = await this.contracts.findActiveByTenantId(tenantId, effectiveAt);
        if (!active) return;
        await this.contracts.terminate(active.id, {
            tenantId,
            effectiveUntil: effectiveAt,
            // Only when it is already over. An ordinary cancellation lands at
            // the term end, months out, and the customer is under this contract
            // until then — the invoice side has to keep finding it, and the
            // window in `findActiveByTenantId` is what stops it afterwards.
            status: effectiveAt <= new Date() ? 'terminated' : null,
        });
        this.entitlements.invalidateTenant(tenantId);
    }

    async freezeOnPlanChange(
        tenantId: string,
        newPlan: string,
        billingCycle: BillingCycle,
        effectiveFrom: Date,
        endsAt: Date | null = null,
        retirement?: RetirementContractTerms,
    ): Promise<void> {
        const data = await this.composeOnPlanChange(
            tenantId,
            newPlan,
            billingCycle,
            effectiveFrom,
            endsAt,
            retirement,
        );
        for (let attempt = 0; attempt < SUCCESSOR_ATTEMPTS; attempt++) {
            const previous = await this.contracts.findActiveByTenantId(tenantId, effectiveFrom);
            const written = await this.contracts.writeSuccessor(previous, data, effectiveFrom);
            if (written) {
                // The next read uses the new contract snapshot.
                this.entitlements.invalidateTenant(tenantId);
                return;
            }
        }
        throw contractChanged(tenantId);
    }

    /**
     * The contract `freezeOnPlanChange` would write, and nothing written: the
     * plan version the subscription is bound to, the add-ons booked, the
     * catalogue's rate and currency, and a promotional code not yet recorded —
     * checked the way a contract is checked before it is written.
     *
     * Public so that an operator's refresh can show a full re-freeze before it
     * makes one, measured by the same rules a plan change is.
     */
    async composeOnPlanChange(
        tenantId: string,
        newPlan: string,
        billingCycle: BillingCycle,
        effectiveFrom: Date,
        endsAt: Date | null = null,
        retirement?: RetirementContractTerms,
    ): Promise<CreateSubscriptionContractData> {
        const cycle: 'monthly' | 'yearly' = billingCycle === 'YEARLY' ? 'yearly' : 'monthly';
        // The catalogue gives the currency and the name the plan is sold under,
        // and the rate where no tax adapter decides; it is the reading the
        // entitlement snapshot below is filtered against.
        const catalog = await this.catalogs.current();
        const fileRate = this.contracts.taxAdapterDecides ? null : rateOfTheFile(catalog).rate;
        // Checked before anything is written: the new contract records this
        // rate, this window and a plan sold in this cycle, and a refusal after
        // the contract in force had ended would leave the tenant with none.
        if (fileRate !== null) assertTaxRatePercent('catalog.vatRate', fileRate);
        assertContractWindow(effectiveFrom, endsAt);
        // What the plan line records — id, price, features, quotas — is the
        // version the subscription is bound to, from one row. After a plan
        // change the write has bound the version it sold; on a re-freeze after
        // an add-on changed it is the version the tenant has had all along,
        // even with a successor on sale (`SC-SUB-024`). The version on sale now
        // would charge a customer who bought v1 the price of v2.
        const bound = await this.source.findBoundPlanVersion(tenantId);
        if (!bound || bound.planId !== newPlan) {
            throw new Error(
                `The contract for tenant ${tenantId} was asked to record plan '${newPlan}', but ` +
                    `the subscription is bound to ${bound ? `'${bound.planId}' (version ${bound.id})` : 'no plan version'}. ` +
                    'Bind the plan version on the subscription before the contract is frozen.',
            );
        }
        const planDef = planDefOfVersion(catalog, newPlan, bound);
        if (isPlanNotSoldInCycle(planDef, billingCycle)) {
            throw new UnprocessableEntityException(planNotSoldInCycle(planDef, billingCycle));
        }
        await this.contracts.assertPartyFor(tenantId, {
            effectiveFrom,
            cycle: billingCycle,
            endsAt,
        });
        // Where a tax adapter decides, the rate is the one decided for the
        // subscriber's origin as it stands, over the contract's first period.
        const vatRate =
            fileRate ??
            ((await this.contracts.contractTaxRateFor(
                { tenantId },
                contractTaxPeriod({ effectiveFrom, effectiveUntil: endsAt, billingCycle }),
            )) as number);

        const bundles = await this.source.loadBookedBundles(tenantId, cycle);
        assertTheMovedBookingHasItsLine(tenantId, bundles.lineItems, retirement);

        const planPriceNet = listPriceNet(planDef, billingCycle) ?? 0;

        const planLineItem: PricedContractLineItem = {
            kind: 'plan',
            sourceKey: newPlan,
            sourceVersionId: bound.id,
            titleSnapshot: planDef.name ?? newPlan,
            descriptionSnapshot: planDef.tagline ?? null,
            quantity: 1,
            unit: null,
            priceNet: planPriceNet,
            billingCycle: cycle,
            minimumTermUntil: null,
            featuresSnapshot: planDef.features,
            quotaEffectsSnapshot: planDef.quotas,
            metadata:
                retirement && !retirement.addOn ? { retirementId: retirement.retirementId } : null,
        };

        const redeemed = await this.redeemedCodeNotYetRecorded(
            tenantId,
            planPriceNet,
            billingCycle,
            vatRate,
        );

        // One recording for every line, plan and add-on alike: the currency,
        // the rate and each line's share of the tax are the installation's, so
        // the place that knows them writes them once rather than each source
        // carrying its own copy.
        const held = retirement?.priceHold
            ? retirement.addOn
                ? addOnPriceHoldLine(
                      retirement.retirementId,
                      lineOfTheMovedBooking(bundles.lineItems, retirement.addOn.bundleVersionId),
                      retirement.addOn.subscriptionBundleId,
                      retirement.priceHold,
                  )
                : priceHoldLine(cycle, retirement.retirementId, bound.id, retirement.priceHold)
            : null;
        const lineItems = recordContractLinesMoney(
            [
                planLineItem,
                ...bundles.lineItems.map((line) => markedForAddOnMove(line, retirement)),
                ...(redeemed ? [redeemed.line] : []),
                ...(held ? [held] : []),
            ],
            { currency: catalog.currency, taxRate: vatRate },
        );
        // Each line keeps the rhythm it is billed in; the total states one
        // period of the contract's own rhythm, so a monthly add-on beside a
        // yearly plan counts twelve times rather than once.
        const totals = contractTotalsOf(lineItems, cycle);
        const priceSnapshot: SubscriptionContractPriceSnapshot = {
            currency: catalog.currency,
            billingCycle: cycle,
            subtotalNet: totals.subtotalNet,
            discountNet: totals.discountNet,
            totalNet: totals.totalNet,
            vatRate,
            totalGross: totals.totalGross,
        };

        // The lines are checked here for the same reason as the rate and the
        // window above.
        assertOnePlanLine(lineItems);
        assertNoNegativeDiscount({ priceSnapshot });

        // What the tenant would get without the freeze, less the add-ons whose
        // cancellation is declared: those keep their line until their effective
        // date, and are granted by the booking until then rather than by a
        // snapshot that would outlive it. The snapshot names them, which is how
        // a reader tells them from the add-ons it does contain.
        const { limits, leftOutBundleVersionIds } = await this.entitlements.computeContractLimits(
            tenantId,
            effectiveFrom,
            catalog,
        );

        const data: CreateSubscriptionContractData = {
            tenantId,
            status: 'active',
            effectiveFrom,
            // The successor inherits the ending. A cancellation capped the
            // contract that was running when it was declared; every contract
            // after it ends on the same date, or the repair lasts exactly until
            // the next plan change.
            effectiveUntil: endsAt,
            originalPlanVersionId: bound.id,
            originalBundleVersionIds: bundles.bundleVersionIds,
            entitlementSnapshot: {
                plan: limits.plan,
                quotas: { ...limits.quotas },
                features: [...limits.features],
                ...(leftOutBundleVersionIds.length > 0 ? { leftOutBundleVersionIds } : {}),
            },
            priceSnapshot,
            promoCodeSnapshots: redeemed ? [redeemed.snapshot] : [],
            lineItems,
        };
        return data;
    }

    /**
     * The code redeemed for the tenant's subscription, as a discount line, where
     * no contract of the tenant records it yet.
     *
     * The first contract written after a redemption records it — at onboarding,
     * or at the activation after a trial, where onboarding wrote none — and the
     * ones after it do not repeat it: the discount runs from where it was first
     * agreed, for the duration on its snapshot, counted from the first period
     * that is paid. A contract concluded from an offer that carried the code
     * already records it. Nothing is recorded without the promo module, for a
     * reversed redemption, or where a contract written since the redemption
     * does not record it: that was the first one, written before contracts
     * recorded codes or by the application itself, and a later contract does
     * not start the discount again.
     */
    private async redeemedCodeNotYetRecorded(
        tenantId: string,
        planPriceNet: number,
        billingCycle: BillingCycle,
        vatRate: number,
    ): Promise<{ line: PricedContractLineItem; snapshot: CheckoutOfferPromoCodeSnapshot } | null> {
        if (!this.promoCodes || !this.subscriptions) return null;
        const subscription = await this.subscriptions.findForTenant(tenantId);
        if (!subscription?.id) return null;
        const redeemed = await this.promoCodes.redeemedCodeFor(subscription.id);
        if (!redeemed) return null;
        const recorded = await this.contracts.list({ tenantId });
        if (
            recorded.some(
                (contract) =>
                    recordsPromoCode(contract, redeemed.code) ||
                    contract.createdAt > redeemed.redeemedAt,
            )
        ) {
            return null;
        }

        const cycle: 'monthly' | 'yearly' = billingCycle === 'YEARLY' ? 'yearly' : 'monthly';
        const snapshot: CheckoutOfferPromoCodeSnapshot = {
            code: redeemed.code,
            label: buildLabel(redeemed, billingCycle),
            valueType: redeemed.valueType,
            value: Number(redeemed.value),
            resolvedAmountNet: promoCodeDiscountNet(planPriceNet, vatRate, redeemed),
            durationType: redeemed.durationType,
            durationValue: redeemed.durationValue,
        };
        const line = generatedDiscountLine(
            { billingCycle: cycle, promoCodeSnapshot: snapshot, promotionSnapshots: [] },
            snapshot.resolvedAmountNet,
        );
        return {
            snapshot,
            line: {
                kind: line.kind,
                sourceKey: line.sourceKey,
                sourceVersionId: line.sourceVersionId ?? null,
                titleSnapshot: line.titleSnapshot,
                descriptionSnapshot: line.descriptionSnapshot ?? null,
                quantity: line.quantity,
                unit: line.unit ?? null,
                priceNet: line.priceNet,
                billingCycle: cycle,
                minimumTermUntil: null,
                featuresSnapshot: [],
                quotaEffectsSnapshot: {},
                metadata: line.metadata ?? null,
            },
        };
    }
}

function recordsPromoCode(contract: SubscriptionContractRecord, code: string): boolean {
    return contract.promoCodeSnapshots.some(
        (snapshot) =>
            snapshot !== null &&
            typeof snapshot === 'object' &&
            (snapshot as { code?: unknown }).code === code,
    );
}

/**
 * The add-on line an add-on retirement moves a booking onto, marked with it:
 * the line the journal waits for to price the booking's periods from its date.
 * Every other line, and every line of a freeze no add-on retirement writes,
 * stays as the source handed it.
 */
function markedForAddOnMove(
    line: PricedContractLineItem,
    retirement: RetirementContractTerms | undefined,
): PricedContractLineItem {
    const target = retirement?.addOn?.bundleVersionId;
    if (!retirement || !target || line.kind !== 'bundle' || line.sourceVersionId !== target) {
        return line;
    }
    return { ...line, metadata: { ...line.metadata, retirementId: retirement.retirementId } };
}

/**
 * Refuses the contract of an add-on retirement's move where the source hands
 * no line for the version the booking moves onto. Written without it, the
 * contract would name nothing the journal could price the booking's periods
 * from the date with, and they would wait for good; refused, the move puts the
 * booking back and the next run makes both (`SC-BUN-050`).
 */
function assertTheMovedBookingHasItsLine(
    tenantId: string,
    lines: readonly PricedContractLineItem[],
    retirement: RetirementContractTerms | undefined,
): void {
    const target = retirement?.addOn?.bundleVersionId;
    if (!target) return;
    if (lines.some((line) => line.kind === 'bundle' && line.sourceVersionId === target)) return;
    throw new Error(
        `The contract for tenant ${tenantId} was asked to record a booking moved onto add-on ` +
            `version ${target}, but loadBookedBundles returned no line for that version. Put the ` +
            'bundle version of each running booking on its line as sourceVersionId.',
    );
}

/**
 * The line of the booking an add-on retirement moves onto `bundleVersionId`,
 * which `assertTheMovedBookingHasItsLine` has asked for before.
 */
function lineOfTheMovedBooking(
    lines: readonly PricedContractLineItem[],
    bundleVersionId: string,
): PricedContractLineItem {
    return lines.find(
        (line) => line.kind === 'bundle' && line.sourceVersionId === bundleVersionId,
    )!;
}

/**
 * The add-on price a retirement's switch holds until the date the booking was
 * told, as a discount line for the difference in the booking's own rhythm:
 * generated, as the plan's is, so the journal reads how long it runs from the
 * line itself, and keyed by the booking that switched and the add-on version
 * it is held on: a later booking of the same add-on agreed to no hold
 * (`SC-BUN-055`).
 */
function addOnPriceHoldLine(
    retirementId: string,
    addOn: PricedContractLineItem,
    subscriptionBundleId: string,
    hold: NonNullable<RetirementContractTerms['priceHold']>,
): PricedContractLineItem {
    return {
        kind: 'discount',
        sourceKey: `retirement-hold:${retirementId}`,
        sourceVersionId: null,
        titleSnapshot: `Price of ${addOn.titleSnapshot} held until ${hold.lastDay}`,
        descriptionSnapshot: null,
        quantity: 1,
        unit: null,
        priceNet: -hold.amountNet,
        billingCycle: addOn.billingCycle,
        minimumTermUntil: null,
        featuresSnapshot: [],
        quotaEffectsSnapshot: {},
        metadata: {
            generated: true,
            source: 'retirement',
            priceHold: {
                retirementId,
                subscriptionBundleId,
                bundleVersionId: addOn.sourceVersionId,
                until: hold.until.toISOString(),
                resolvedAmountNet: hold.amountNet,
            },
        },
    };
}

/**
 * The price a retirement's switch holds until the date the subscriber was told,
 * as a discount line for the difference: generated, so the journal reads how
 * long it runs from the line itself rather than from the contracts written
 * after it (`SC-PRIC-063`).
 */
function priceHoldLine(
    cycle: 'monthly' | 'yearly',
    retirementId: string,
    planVersionId: string,
    hold: NonNullable<RetirementContractTerms['priceHold']>,
): PricedContractLineItem {
    return {
        kind: 'discount',
        sourceKey: `retirement-hold:${retirementId}`,
        sourceVersionId: null,
        titleSnapshot: `Price held until ${hold.lastDay}`,
        descriptionSnapshot: null,
        quantity: 1,
        unit: null,
        priceNet: -hold.amountNet,
        billingCycle: cycle,
        minimumTermUntil: null,
        featuresSnapshot: [],
        quotaEffectsSnapshot: {},
        metadata: {
            generated: true,
            source: 'retirement',
            priceHold: {
                retirementId,
                planVersionId,
                until: hold.until.toISOString(),
                resolvedAmountNet: hold.amountNet,
            },
        },
    };
}
