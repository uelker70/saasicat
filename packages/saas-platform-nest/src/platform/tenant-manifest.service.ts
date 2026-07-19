// TenantManifestService — App registriert NavItems, Service rendert pro
// Tenant ein gefiltertes Manifest.
//
// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P14.

import { Injectable } from '@nestjs/common';
import { StaticEntitlementService } from './static-entitlement.service.js';
import type { TenantManifest, TenantNavItem } from './tenant-manifest.types.js';

@Injectable()
export class TenantManifestService {
    private readonly navItems: TenantNavItem[] = [];

    constructor(private readonly entitlements: StaticEntitlementService) {}

    /**
     * Im `OnModuleInit` der App aufrufen: registriert App-Navigation für die
     * Tenant-UI. Idempotent: gleicher `id` überschreibt.
     */
    registerNavItem(item: TenantNavItem): void {
        const existing = this.navItems.findIndex((i) => i.id === item.id);
        if (existing >= 0) this.navItems[existing] = item;
        else this.navItems.push(item);
    }

    /** Bulk-Variante. */
    registerNavItems(items: TenantNavItem[]): void {
        for (const item of items) this.registerNavItem(item);
    }

    /**
     * Liefert das gefilterte Manifest für einen Tenant. NavItems mit
     * `requiresFeature` werden serverseitig ausgesiebt, sobald keines der
     * geforderten Features im Entitlement-Snapshot enthalten ist.
     */
    async getManifest(tenantId: string): Promise<TenantManifest> {
        const snap = await this.entitlements.snapshot(tenantId);
        const featureSet = new Set(snap.features);

        const visible = this.navItems
            .filter((item) => isVisible(item, featureSet))
            .map((item) => ({ ...item }))
            .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));

        return {
            schemaVersion: 1,
            tenant: { id: tenantId },
            planId: snap.planId,
            features: snap.features,
            quotas: snap.quotas,
            navigation: visible,
        };
    }
}

function isVisible(item: TenantNavItem, features: Set<string>): boolean {
    if (!item.requiresFeature) return true;
    const required = Array.isArray(item.requiresFeature)
        ? item.requiresFeature
        : [item.requiresFeature];
    return required.some((f) => features.has(f));
}
