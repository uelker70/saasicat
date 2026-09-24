import { Inject, Injectable, Optional, UnprocessableEntityException } from '@nestjs/common';
import type {
    BillingCycle,
    CreateSubscriptionContractData,
    SubscriptionContractPriceSnapshot,
    TenantSubscriptionWritePort,
} from '@saasicat/core';

import { EntitlementService } from '../entitlement/entitlement.service.js';
import { ENTITLEMENT_SERVICE_TOKEN } from '../entitlement/entitlement.tokens.js';
import { SubscriptionContractService } from '../subscription-contract/subscription-contract.service.js';
import { PLAN_CATALOG_SOURCE_TOKEN } from './plan-catalog.module.js';
import type { PlanCatalogSource } from './plan-catalog-source.js';
import { planDefFromVersion } from './plan-catalog-from-snapshot.js';
import { SUBSCRIPTION_WRITE_PORT_TOKEN } from './tenant-billing.tokens.js';
import {
    findPlan,
    isPlanNotSoldInCycle,
    listPriceNet,
    planNotSoldInCycle,
} from './plan-helpers.js';
import {
    CONTRACT_FREEZE_SOURCE_PORT_TOKEN,
    type ContractFreezePort,
    type ContractFreezeSourcePort,
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

    assertPartyFor(tenantId: string): Promise<void> {
        return this.contracts.assertPartyFor(tenantId);
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
    ): Promise<void> {
        const cycle: 'monthly' | 'yearly' = billingCycle === 'YEARLY' ? 'yearly' : 'monthly';
        // The catalogue gives the rate, the currency and the name the plan is
        // sold under, and it is the reading the entitlement snapshot below is
        // filtered against.
        const catalog = await this.catalogs.current();
        const vatRate = catalog.vatRate;
        // Before the previous contract is closed below: the new one records this
        // rate, this window and a plan sold in this cycle, and a refusal after
        // the termination would leave no contract.
        assertTaxRatePercent('catalog.vatRate', vatRate);
        assertContractWindow(effectiveFrom, endsAt);
        // What the plan line records — id, price, features, quotas — is the
        // version the subscription is bound to, from one row. After a plan
        // change the write has bound the version it sold; on a re-freeze after
        // an add-on changed it is the version the tenant has had all along,
        // even with a successor on sale (`SC-SUB-012`). The version on sale now
        // would charge a customer who bought v1 the price of v2.
        const bound = await this.source.findBoundPlanVersion(tenantId);
        if (!bound || bound.planId !== newPlan) {
            throw new Error(
                `The contract for tenant ${tenantId} was asked to record plan '${newPlan}', but ` +
                    `the subscription is bound to ${bound ? `'${bound.planId}' (version ${bound.id})` : 'no plan version'}. ` +
                    'Bind the plan version on the subscription before the contract is frozen.',
            );
        }
        const stem = findPlan(catalog, newPlan);
        const planDef = planDefFromVersion(
            { id: newPlan, name: stem?.name ?? newPlan, tagline: stem?.tagline },
            bound,
        );
        if (isPlanNotSoldInCycle(planDef, billingCycle)) {
            throw new UnprocessableEntityException(planNotSoldInCycle(planDef, billingCycle));
        }
        await this.contracts.assertPartyFor(tenantId);

        const bundles = await this.source.loadBookedBundles(tenantId, cycle);

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
            metadata: null,
        };

        // One recording for every line, plan and add-on alike: the currency,
        // the rate and each line's share of the tax are the installation's, so
        // the place that knows them writes them once rather than each source
        // carrying its own copy.
        const lineItems = recordContractLinesMoney([planLineItem, ...bundles.lineItems], {
            currency: catalog.currency,
            taxRate: vatRate,
        });
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

        // The lines depend on nothing the termination changes, so they are checked
        // before it, for the same reason as the rate and the window above.
        assertOnePlanLine(lineItems);
        assertNoNegativeDiscount({ priceSnapshot });

        // Terminate the old active contract so that `computeContractLimits` takes the
        // catalog path (otherwise it would read back the OLD frozen snapshot).
        const previous = await this.contracts.findActiveByTenantId(tenantId, effectiveFrom);
        if (previous) {
            await this.contracts.terminate(previous.id, {
                effectiveUntil: effectiveFrom,
                status: 'superseded',
            });
        }
        this.entitlements.invalidateTenant(tenantId);

        // What the tenant would get without the freeze, less the add-ons whose
        // cancellation is declared: those keep their line until their effective
        // date, and are granted by the booking until then rather than by a
        // snapshot that would outlive it.
        const limits = await this.entitlements.computeContractLimits(
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
            },
            priceSnapshot,
            lineItems,
        };

        await this.contracts.create(data);
        // The next read uses the new contract snapshot.
        this.entitlements.invalidateTenant(tenantId);
    }
}
