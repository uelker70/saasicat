import { Inject, Injectable } from '@nestjs/common';
import type {
    BillingCycle,
    CreateSubscriptionContractData,
    NewContractLineItemData,
} from '@saasicat/types';

import { EntitlementService } from '../entitlement/index.js';
import { ENTITLEMENT_SERVICE_TOKEN } from '../entitlement/tokens.js';
import { SubscriptionContractService } from '../subscription-contract/index.js';
import { PLAN_CATALOG_TOKEN } from './plan-catalog.module.js';
import { findPlan, getPlanPriceNet } from './plan-helpers.js';
import type { PlanCatalog } from '@saasicat/types';
import {
    CONTRACT_FREEZE_PROJECT_KEY_TOKEN,
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
// Consumer-specific are only `projectKey` (config) and the bundle/version
// data access (`ContractFreezeSourcePort`).

@Injectable()
export class SubscriptionContractFreezeService implements ContractFreezePort {
    constructor(
        @Inject(PLAN_CATALOG_TOKEN) private readonly catalog: PlanCatalog,
        // tsup build has no emitDecoratorMetadata — class type args explicitly @Inject.
        @Inject(ENTITLEMENT_SERVICE_TOKEN) private readonly entitlements: EntitlementService,
        @Inject(SubscriptionContractService)
        private readonly contracts: SubscriptionContractService,
        @Inject(CONTRACT_FREEZE_PROJECT_KEY_TOKEN) private readonly projectKey: string,
        @Inject(CONTRACT_FREEZE_SOURCE_PORT_TOKEN)
        private readonly source: ContractFreezeSourcePort,
    ) {}

    async freezeOnPlanChange(
        tenantId: string,
        newPlan: string,
        billingCycle: BillingCycle,
        effectiveFrom: Date,
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
        const subtotalNet = round2(lineItems.reduce((sum, li) => sum + li.priceNet, 0));

        const data: CreateSubscriptionContractData = {
            projectKey: this.projectKey,
            tenantId,
            status: 'active',
            effectiveFrom,
            effectiveUntil: null,
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

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}
