// StaticEntitlementService — lightweight entitlement from a static
// PlanCatalog. In the quickstart path this suffices, because no
// SubscriptionContracts exist yet.
//
// Path distinction:
//   - Quickstart (here):  plan catalog + PlanResolverPort → features/quotas
//   - Full V3 setup:      SubscriptionContract → EntitlementService
//     (a standalone service in the billing/entitlement sub-entry that
//      handles the full contract/bundle aggregation).
//
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P7+P9.

import { Inject, Injectable } from '@nestjs/common';
import type { PlanCatalog, PlanDef } from '@saasicat/types';
import { PLAN_CATALOG_TOKEN } from '../billing/plan-catalog.module.js';
import { PLAN_RESOLVER_PORT_TOKEN, type PlanResolverPort } from './plan-resolver.port.js';

export interface StaticEntitlementSnapshot {
    planId: string | null;
    features: readonly string[];
    /** quotaKey → limit (`-1` = unlimited). */
    quotas: Readonly<Record<string, number>>;
}

@Injectable()
export class StaticEntitlementService {
    constructor(
        @Inject(PLAN_CATALOG_TOKEN) private readonly catalog: PlanCatalog,
        @Inject(PLAN_RESOLVER_PORT_TOKEN) private readonly resolver: PlanResolverPort,
    ) {}

    /**
     * Returns the effective features + quotas of a tenant from the
     * plan catalog. When the plan is missing: an empty snapshot (no feature,
     * all quotas at 0).
     */
    async snapshot(tenantId: string): Promise<StaticEntitlementSnapshot> {
        const planId = await this.resolver.getPlanIdForTenant(tenantId);
        if (!planId) {
            return { planId: null, features: [], quotas: {} };
        }
        const plan = this.findPlan(planId);
        if (!plan) {
            return { planId, features: [], quotas: {} };
        }
        return {
            planId,
            features: plan.features ?? [],
            quotas: plan.quotas ?? {},
        };
    }

    /** Convenience helper for tests / synchronous checks in the UI manifest. */
    async hasFeature(tenantId: string, featureKey: string): Promise<boolean> {
        const snap = await this.snapshot(tenantId);
        return snap.features.includes(featureKey);
    }

    async quotaLimit(tenantId: string, quotaKey: string): Promise<number | null> {
        const snap = await this.snapshot(tenantId);
        const value = snap.quotas[quotaKey];
        return value === undefined ? null : value;
    }

    private findPlan(planId: string): PlanDef | undefined {
        return (this.catalog.plans ?? []).find((p) => p.id === planId);
    }
}
