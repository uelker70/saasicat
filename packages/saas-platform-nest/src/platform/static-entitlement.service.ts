// StaticEntitlementService — Lightweight-Entitlement aus statischem
// PlanCatalog. Im Quickstart-Pfad reicht das, weil noch keine
// SubscriptionContracts existieren.
//
// Pfade-Unterscheidung:
//   - Quickstart (hier): Plan-Catalog + PlanResolverPort → Features/Quotas
//   - Volles V3-Setup:   SubscriptionContract → EntitlementService
//     (eigenständiger Service im billing/entitlement-Sub-Entry, der die
//      vollständige Vertrags-/Bundle-Aggregation übernimmt).
//
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P7+P9.

import { Inject, Injectable } from '@nestjs/common';
import type { PlanCatalog, PlanDef } from '@saasicat/types';
import { PLAN_CATALOG_TOKEN } from '../billing/plan-catalog.module.js';
import { PLAN_RESOLVER_PORT_TOKEN, type PlanResolverPort } from './plan-resolver.port.js';

export interface StaticEntitlementSnapshot {
    planId: string | null;
    features: readonly string[];
    /** quotaKey → Limit (`-1` = unbegrenzt). */
    quotas: Readonly<Record<string, number>>;
}

@Injectable()
export class StaticEntitlementService {
    constructor(
        @Inject(PLAN_CATALOG_TOKEN) private readonly catalog: PlanCatalog,
        @Inject(PLAN_RESOLVER_PORT_TOKEN) private readonly resolver: PlanResolverPort,
    ) {}

    /**
     * Liefert die effektiven Features+Quotas eines Tenants aus dem
     * Plan-Catalog. Bei fehlendem Plan: leeres Snapshot (kein Feature, alle
     * Quotas auf 0).
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

    /** Bequeme Helper für Tests / synchrone Checks im UI-Manifest. */
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
