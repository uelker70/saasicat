import { Inject, Injectable } from '@nestjs/common';
import type {
    BillingCycle,
    CreateSubscriptionContractData,
    NewContractLineItemData,
} from '@saasicat/core';

import { EntitlementService } from '../entitlement/entitlement.service.js';
import { ENTITLEMENT_SERVICE_TOKEN } from '../entitlement/entitlement.tokens.js';
import { SubscriptionContractService } from '../subscription-contract/subscription-contract.service.js';
import { PLAN_CATALOG_TOKEN } from './plan-catalog.module.js';
import { findPlan, getPlanPriceNet } from './plan-helpers.js';
import type { PlanCatalog } from '@saasicat/core';
import {
    CONTRACT_FREEZE_SOURCE_PORT_TOKEN,
    type ContractFreezePort,
    type ContractFreezeSourcePort,
} from './contract-freeze.tokens.js';

// SubscriptionContractFreezeService (#18) — on a plan change, freezes the
// agreed service as a `SubscriptionContract` with `entitlementSnapshot`.
// The `EntitlementService` reads the active contract FIRST → from the change
// onward the tenant's entitlements are catalog-independent (AdminUI edits/deletes
// no longer touch the running plan), and the change is documented audit-safely
// via the frozen line items + prices.
//
// Generic: uses EntitlementService + SubscriptionContractService + PlanCatalog.
// Consumer-specific is only the bundle/version data access
// (`ContractFreezeSourcePort`).

@Injectable()
export class SubscriptionContractFreezeService implements ContractFreezePort {
    constructor(
        @Inject(PLAN_CATALOG_TOKEN) private readonly catalog: PlanCatalog,
        // tsup build has no emitDecoratorMetadata — class type args explicitly @Inject.
        @Inject(ENTITLEMENT_SERVICE_TOKEN) private readonly entitlements: EntitlementService,
        @Inject(SubscriptionContractService)
        private readonly contracts: SubscriptionContractService,
        @Inject(CONTRACT_FREEZE_SOURCE_PORT_TOKEN)
        private readonly source: ContractFreezeSourcePort,
    ) {}

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
        const vatRate = this.catalog.vatRate;

        const bundles = await this.source.loadBookedBundles(tenantId, cycle, vatRate);
        const livePlanVersionId = await this.source.findLivePlanVersionId(newPlan);

        // Terminate the old active contract so that `computeLimits` takes the
        // catalog path (otherwise it would read back the OLD frozen snapshot).
        const previous = await this.contracts.findActiveByTenantId(tenantId, effectiveFrom);
        if (previous) {
            await this.contracts.terminate(previous.id, {
                effectiveUntil: effectiveFrom,
                status: 'superseded',
            });
        }
        this.entitlements.invalidateTenant(tenantId);

        // Effective entitlements (plan + bundles + add-ons) as a snapshot — exactly
        // what the tenant would get without the freeze. That makes the snapshot correct.
        const limits = await this.entitlements.computeLimits(tenantId, effectiveFrom);

        const planDef = findPlan(this.catalog, newPlan);
        const planPriceNet = getPlanPriceNet(this.catalog, newPlan, billingCycle) ?? 0;

        const planLineItem: NewContractLineItemData = {
            kind: 'plan',
            sourceKey: newPlan,
            sourceVersionId: livePlanVersionId,
            titleSnapshot: planDef?.name ?? newPlan,
            descriptionSnapshot: planDef?.tagline ?? null,
            quantity: 1,
            unit: null,
            priceNet: planPriceNet,
            priceGross: round2(planPriceNet * (1 + vatRate / 100)),
            billingCycle: cycle,
            minimumTermUntil: null,
            featuresSnapshot: planDef?.features ?? [],
            quotaEffectsSnapshot: planDef?.quotas ?? {},
            metadata: null,
        };

        const lineItems: NewContractLineItemData[] = [planLineItem, ...bundles.lineItems];
        // Each line keeps the rhythm it is billed in; the total states one
        // period of the contract's own rhythm, so a line billed more often than
        // the contract counts as often as it falls due.
        //
        // Add-ons may run monthly beside a yearly plan, so the two rhythms sit
        // in one contract and adding the figures as they stand would put a
        // single month of an add-on into a year's total. That was the shape
        // before mixed rhythms could be bought; now they can.
        const subtotalNet = round2(
            lineItems.reduce((sum, li) => sum + priceOverOnePeriodOf(cycle, li), 0),
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
            originalPlanVersionId: livePlanVersionId,
            originalBundleVersionIds: bundles.bundleVersionIds,
            entitlementSnapshot: {
                plan: limits.plan,
                quotas: { ...limits.quotas },
                features: [...limits.features],
            },
            priceSnapshot: {
                currency: this.catalog.currency,
                billingCycle: cycle,
                subtotalNet,
                discountNet: 0,
                totalNet: subtotalNet,
                vatRate,
                totalGross: round2(subtotalNet * (1 + vatRate / 100)),
            },
            lineItems,
        };

        await this.contracts.create(data);
        // The next read uses the new contract snapshot.
        this.entitlements.invalidateTenant(tenantId);
    }
}

/**
 * What a line costs over one period of the contract's rhythm.
 *
 * A monthly line in a yearly contract falls due twelve times, so it counts
 * twelve times. The other direction cannot occur — a bundle may not outlast the
 * plan it hangs on, which is what `bundleCycleFitsPlan` refuses — and if it
 * ever did, dividing would invent a price nobody is charged, so it is left as
 * it stands and the line's own `billingCycle` says what it really is.
 */
function priceOverOnePeriodOf(
    contractCycle: 'monthly' | 'yearly',
    line: { priceNet: number; billingCycle: 'monthly' | 'yearly' },
): number {
    const monthlyInYearly = contractCycle === 'yearly' && line.billingCycle === 'monthly';
    return monthlyInYearly ? line.priceNet * MONTHS_PER_YEAR : line.priceNet;
}

const MONTHS_PER_YEAR = 12;

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}
