import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { AdminManifest, ManifestContribution } from '@saasicat/types';
import { ADMIN_MANIFEST_CONFIG, type AdminManifestConfig } from './admin-manifest.config.js';

/**
 * DI-Token für die Plattform-Core-Contribution. Wenn das `AdminManifestModule`
 * mit `registerPlatformCore: true` (Default) konfiguriert ist, liefert das
 * Modul `PLATFORM_CORE_MANIFEST_CONTRIBUTION` unter diesem Token. Der Service
 * registriert die Contribution im Constructor — vor allen App-`register()`-
 * Aufrufen aus `onModuleInit`.
 */
export const PLATFORM_CORE_CONTRIBUTION_TOKEN = Symbol('PLATFORM_CORE_CONTRIBUTION');

// AdminManifestService — sammelt ManifestContribution-Beiträge der App-Module
// (via expliziter register()-Aufrufe in deren onModuleInit) und liefert das
// fertige, deterministisch gehashte Voll-Manifest aus.

@Injectable()
export class AdminManifestService {
    private readonly logger = new Logger(AdminManifestService.name);
    private readonly contributions: ManifestContribution[] = [];
    private cached: AdminManifest | null = null;

    constructor(
        @Inject(ADMIN_MANIFEST_CONFIG) private readonly config: AdminManifestConfig,
        @Optional()
        @Inject(PLATFORM_CORE_CONTRIBUTION_TOKEN)
        platformCore: ManifestContribution | null = null,
    ) {
        if (platformCore) {
            this.contributions.push(platformCore);
        }
    }

    register(contribution: ManifestContribution): void {
        this.contributions.push(contribution);
        this.cached = null;
    }

    getManifest(): AdminManifest {
        if (this.cached) return this.cached;
        this.cached = this.build();
        this.logger.log(
            `Manifest built: ${this.contributions.length} contribution(s), hash=${this.cached.build.manifestHash.slice(0, 24)}…`,
        );
        return this.cached;
    }

    rebuild(): AdminManifest {
        this.cached = null;
        return this.getManifest();
    }

    private build(): AdminManifest {
        const merged = this.mergeContributions(this.contributions);
        const draft: AdminManifest = {
            schemaVersion: 1,
            project: this.config.project,
            build: { ...this.config.build, manifestHash: 'sha256-pending' },
            planCatalogSnapshot: this.config.planCatalogSnapshot,
            capabilities: merged.capabilities,
            navigation: merged.navigation,
            dashboard: merged.dashboard,
            tenants: merged.tenants,
            audit: merged.audit,
        };
        return { ...draft, build: { ...draft.build, manifestHash: this.computeHash(draft) } };
    }

    private mergeContributions(contributions: ManifestContribution[]): {
        capabilities: AdminManifest['capabilities'];
        navigation: AdminManifest['navigation'];
        dashboard?: AdminManifest['dashboard'];
        tenants?: AdminManifest['tenants'];
        audit?: AdminManifest['audit'];
    } {
        const capabilities: AdminManifest['capabilities'] = {};
        const standardPages: NonNullable<AdminManifest['navigation']['standardPages']> = {};
        const projectPages: NonNullable<AdminManifest['navigation']['projectPages']> = [];
        const kpiCards: NonNullable<NonNullable<AdminManifest['dashboard']>['kpiCards']> = [];
        const tenantColumns: NonNullable<NonNullable<AdminManifest['tenants']>['columns']> = [];
        const tenantActions: NonNullable<NonNullable<AdminManifest['tenants']>['actions']> = [];
        const auditActions: NonNullable<NonNullable<AdminManifest['audit']>['actions']> = [];

        for (const c of contributions) {
            if (c.capabilities) Object.assign(capabilities, c.capabilities);
            if (c.navigation?.standardPages)
                Object.assign(standardPages, c.navigation.standardPages);
            if (c.navigation?.projectPages) projectPages.push(...c.navigation.projectPages);
            if (c.dashboard?.kpiCards) kpiCards.push(...c.dashboard.kpiCards);
            if (c.tenants?.columns) tenantColumns.push(...c.tenants.columns);
            if (c.tenants?.actions) tenantActions.push(...c.tenants.actions);
            if (c.audit?.actions) auditActions.push(...c.audit.actions);
        }

        kpiCards.sort((a, b) => (b.slotPriority ?? 0) - (a.slotPriority ?? 0));

        return {
            capabilities,
            navigation: { standardPages, projectPages },
            dashboard: kpiCards.length > 0 ? { kpiCards } : undefined,
            tenants:
                tenantColumns.length > 0 || tenantActions.length > 0
                    ? { columns: tenantColumns, actions: tenantActions }
                    : undefined,
            audit: auditActions.length > 0 ? { actions: auditActions } : undefined,
        };
    }

    /**
     * Deterministischer SHA-256-Hash über das Manifest. Benutzt Insertion-
     * Order der Object-Keys — sodass semantisch bedeutsame Reorders (z. B.
     * Reihenfolge der Sidebar-Items in `navigation.standardPages`) den Hash
     * verändern und den Browser-ETag-Cache invalidieren. Das eigene
     * `manifestHash`-Feld wird vor der Serialisierung ausgeblendet.
     */
    private computeHash(manifest: AdminManifest): string {
        const canonical = stableStringify({
            ...manifest,
            build: { ...manifest.build, manifestHash: undefined },
        });
        const digest = createHash('sha256').update(canonical).digest('base64url');
        return `sha256-${digest}`;
    }
}

function stableStringify(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'null';
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'string') return JSON.stringify(value);
    if (Array.isArray(value)) {
        return '[' + value.map(stableStringify).join(',') + ']';
    }
    if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        // Insertion-Order statt alphabetischer Sortierung: für das Manifest
        // ist die Key-Reihenfolge in `navigation.standardPages` UI-Render-
        // Order (Sidebar). Wenn der Hash diese Reihenfolge ignoriert, ändert
        // ein Re-Order am Backend den Hash nicht, ETag bleibt gleich, der
        // Browser zeigt weiterhin die alte Reihenfolge aus dem Cache.
        const keys = Object.keys(obj).filter((k) => obj[k] !== undefined);
        return (
            '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}'
        );
    }
    return JSON.stringify(value);
}
