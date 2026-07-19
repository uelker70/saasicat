// BusinessTypesService — CRUD für `business_types` + `business_type_versions`.
//
// Analog zu BundlesService, aber mit zusätzlichen Strict-Mode-Checks für
// die Bundle-Komposition (Disjointness, Compatibility, Bundle-Existence)
// und einem anderen Diff-Klassifikator (`classifyBusinessTypeVersionDiff`).
//
// Spec: yada-services/handoff/superadmin/SPEC_V2.md §11.1 M3
//        + GESCHAEFTSTYP_SPEC.md §6 + §10

import {
    Inject,
    Injectable,
    NotFoundException,
    Optional,
    UnprocessableEntityException,
} from '@nestjs/common';
import {
    classifyBusinessTypeVersionDiff,
    type BundleRepository,
    type BundleVersionRow,
    type BusinessTypeRepository,
    type BusinessTypeRow,
    type BusinessTypeVersionMutationResult,
    type BusinessTypeVersionRow,
    type CatalogEntryRepository,
    type CreateBusinessTypeData,
    type CreateBusinessTypeVersionDraftData,
    type DiscoverySnapshot,
    type PublishBusinessTypeVersionData,
    type StrictModeWarning,
    type UpdateBusinessTypeData,
    type UpdateBusinessTypeVersionDraftData,
} from '@saasicat/types';

import { DISCOVERY_SNAPSHOT_TOKEN } from '../discovery/tokens.js';
import { DiscoveryScanner } from '../discovery/discovery.scanner.js';
import { resolveDiscoverySnapshot } from '../core/discovery-snapshot-source.js';
import type { CatalogServiceConfig } from './bundles.service.js';
import { loadApprovedCatalogKeys } from './approved-keys.js';
import { validateBusinessTypeDraft } from './strict-mode-check.js';
import {
    BUNDLE_REPOSITORY_TOKEN,
    BUSINESS_TYPE_REPOSITORY_TOKEN,
    CATALOG_ENTRY_REPOSITORY_TOKEN,
    CATALOG_SERVICE_CONFIG_TOKEN,
} from './tokens.js';

@Injectable()
export class BusinessTypesService {
    private readonly mode: 'warn-only' | 'blocking';

    constructor(
        @Inject(BUSINESS_TYPE_REPOSITORY_TOKEN)
        private readonly repo: BusinessTypeRepository,
        @Inject(BUNDLE_REPOSITORY_TOKEN)
        private readonly bundleRepo: BundleRepository,
        @Optional()
        @Inject(DISCOVERY_SNAPSHOT_TOKEN)
        private readonly snapshot: DiscoverySnapshot | null = null,
        @Optional()
        @Inject(CATALOG_SERVICE_CONFIG_TOKEN)
        config: CatalogServiceConfig = {},
        @Optional()
        @Inject(DiscoveryScanner)
        private readonly scanner: DiscoveryScanner | null = null,
        @Optional()
        @Inject(CATALOG_ENTRY_REPOSITORY_TOKEN)
        private readonly catalogEntries: CatalogEntryRepository | null = null,
    ) {
        // Kein Snapshot-Guard wie in Bundles/PlanVersions: Disjointness-/
        // Compatibility-Checks (GESCHAEFTSTYP_SPEC §6.3/§6.4) brauchen keine
        // Discovery; nur die Quota-Prüfung nutzt den Snapshot (synthetischer
        // Leer-Fallback). blocking ohne Snapshot ist hier also zulässig.
        this.mode = config.strictModeCheckMode ?? 'blocking';
    }

    // =========================================================================
    // Stamm-Operationen
    // =========================================================================

    listBusinessTypes(projectKey: string): Promise<BusinessTypeRow[]> {
        return this.repo.list({ projectKey, excludeDeleted: true });
    }

    async getBusinessType(
        businessTypeId: string,
    ): Promise<{ businessType: BusinessTypeRow; versions: BusinessTypeVersionRow[] }> {
        const businessType = await this.repo.findById(businessTypeId);
        if (!businessType) {
            throw new NotFoundException(`BusinessType '${businessTypeId}' nicht gefunden`);
        }
        const versions = await this.repo.listVersions(businessTypeId);
        return { businessType, versions };
    }

    async createBusinessType(data: CreateBusinessTypeData): Promise<BusinessTypeRow> {
        const existing = await this.repo.findByKey(data.projectKey, data.businessTypeKey);
        if (existing) {
            throw new UnprocessableEntityException(
                `BusinessType '${data.businessTypeKey}' existiert bereits in Projekt '${data.projectKey}'`,
            );
        }
        return this.repo.create(data);
    }

    async updateBusinessType(
        businessTypeId: string,
        data: UpdateBusinessTypeData,
    ): Promise<BusinessTypeRow> {
        const existing = await this.repo.findById(businessTypeId);
        if (!existing) {
            throw new NotFoundException(`BusinessType '${businessTypeId}' nicht gefunden`);
        }
        return this.repo.update(businessTypeId, data);
    }

    async softDeleteBusinessType(businessTypeId: string): Promise<void> {
        const existing = await this.repo.findById(businessTypeId);
        if (!existing) {
            throw new NotFoundException(`BusinessType '${businessTypeId}' nicht gefunden`);
        }
        if (existing.deletedAt !== null) return;
        await this.repo.softDelete(businessTypeId);
    }

    // =========================================================================
    // Version-Operationen
    // =========================================================================

    listBusinessTypeVersions(businessTypeId: string): Promise<BusinessTypeVersionRow[]> {
        return this.repo.listVersions(businessTypeId);
    }

    async getBusinessTypeVersion(versionId: string): Promise<BusinessTypeVersionRow> {
        const version = await this.repo.findVersionById(versionId);
        if (!version) {
            throw new NotFoundException(`BusinessTypeVersion '${versionId}' nicht gefunden`);
        }
        return version;
    }

    async createBusinessTypeDraft(
        data: CreateBusinessTypeVersionDraftData,
    ): Promise<BusinessTypeVersionMutationResult> {
        const businessType = await this.repo.findById(data.businessTypeId);
        if (!businessType) {
            throw new NotFoundException(`BusinessType '${data.businessTypeId}' nicht gefunden`);
        }

        const existingDraft = await this.repo.findCurrentDraft(data.businessTypeId);
        if (existingDraft) {
            throw new UnprocessableEntityException(
                `BusinessType '${businessType.businessTypeKey}' hat bereits eine Draft-Version v${existingDraft.version}; bitte erst publishen oder verwerfen`,
            );
        }

        if (!data.bundles || data.bundles.length === 0) {
            throw new UnprocessableEntityException(
                'BusinessTypeVersion muss mindestens einen Bundle referenzieren (siehe GESCHAEFTSTYP_SPEC §10).',
            );
        }

        const bundleVersions = await this.loadAndAssertBundles(
            data.bundles.map((b) => b.bundleVersionId),
        );

        if (data.baseVersionId === undefined) {
            const latestLive = await this.repo.findLatestLive(data.businessTypeId);
            data = { ...data, baseVersionId: latestLive?.id ?? null };
        }

        const warnings = await this.runStrictCheck(
            {
                businessTypeKey: businessType.businessTypeKey,
                quotaOverrides: (data.quotaOverrides ?? {}) as Record<string, number>,
            },
            bundleVersions,
        );
        this.gateOrPass(warnings);

        const businessTypeVersion = await this.repo.createDraft(data);
        return { businessTypeVersion, warnings };
    }

    async updateBusinessTypeDraft(
        versionId: string,
        data: UpdateBusinessTypeVersionDraftData,
    ): Promise<BusinessTypeVersionMutationResult> {
        const existing = await this.repo.findVersionById(versionId);
        if (!existing) {
            throw new NotFoundException(`BusinessTypeVersion '${versionId}' nicht gefunden`);
        }
        if (existing.publishedAt !== null) {
            throw new UnprocessableEntityException(
                `BusinessTypeVersion '${versionId}' ist bereits published und kann nicht mehr geändert werden`,
            );
        }

        const businessType = await this.repo.findById(existing.businessTypeId);
        if (!businessType) {
            throw new NotFoundException(
                `BusinessType '${existing.businessTypeId}' nicht gefunden (referentielle Inkonsistenz)`,
            );
        }

        const targetBundles =
            data.bundles ??
            existing.bundles.map((b) => ({
                bundleVersionId: b.bundleVersionId,
                sortOrder: b.sortOrder,
            }));
        if (targetBundles.length === 0) {
            throw new UnprocessableEntityException(
                'BusinessTypeVersion muss mindestens einen Bundle referenzieren.',
            );
        }
        const bundleVersions = await this.loadAndAssertBundles(
            targetBundles.map((b) => b.bundleVersionId),
        );

        const warnings = await this.runStrictCheck(
            {
                businessTypeKey: businessType.businessTypeKey,
                quotaOverrides: (data.quotaOverrides ?? existing.quotaOverrides) as Record<
                    string,
                    number
                >,
            },
            bundleVersions,
        );
        this.gateOrPass(warnings);

        const businessTypeVersion = await this.repo.updateDraft(versionId, data);
        return { businessTypeVersion, warnings };
    }

    async publishBusinessTypeVersion(
        versionId: string,
        publishMeta: PublishBusinessTypeVersionData,
    ): Promise<BusinessTypeVersionMutationResult> {
        const draft = await this.repo.findVersionById(versionId);
        if (!draft) {
            throw new NotFoundException(`BusinessTypeVersion '${versionId}' nicht gefunden`);
        }
        if (draft.publishedAt !== null) {
            throw new UnprocessableEntityException(
                `BusinessTypeVersion '${versionId}' ist bereits published`,
            );
        }

        const businessType = await this.repo.findById(draft.businessTypeId);
        if (!businessType) {
            throw new NotFoundException(`BusinessType '${draft.businessTypeId}' nicht gefunden`);
        }
        const bundleVersions = await this.loadAndAssertBundles(
            draft.bundles.map((b) => b.bundleVersionId),
        );

        const warnings = await this.runStrictCheck(
            {
                businessTypeKey: businessType.businessTypeKey,
                quotaOverrides: draft.quotaOverrides as Record<string, number>,
            },
            bundleVersions,
        );
        this.gateOrPass(warnings);

        const previous = await this.repo.findLatestLive(draft.businessTypeId);
        const diff = previous
            ? classifyBusinessTypeVersionDiff(previous, draft)
            : { changes: [], nonRegressive: true };

        if (!diff.nonRegressive && !publishMeta.forceRegressive) {
            throw new UnprocessableEntityException({
                code: 'BUSINESS_TYPE_VERSION_REGRESSION',
                message:
                    'Diese BusinessTypeVersion ist regressiv (Bundle entfernt / Quota-Override gesenkt / Preis erhöht). ' +
                    'Publishen erfordert explizites `forceRegressive: true` (UI-Bestätigungsmodal mit MFA).',
                changes: diff.changes,
            });
        }

        const businessTypeVersion = await this.repo.publishDraft(versionId, {
            publishedByUserId: publishMeta.publishedByUserId,
            publishedChanges: diff.changes,
            nonRegressive: diff.nonRegressive,
        });
        return { businessTypeVersion, warnings };
    }

    // =========================================================================
    // Helper
    // =========================================================================

    /**
     * Lädt die referenzierten BundleVersions und prüft, dass alle existieren
     * und published sind (live oder superseded — beides erlaubt, weil
     * BusinessTypeBundle die konkrete Version hält). Wirft NotFound bei
     * fehlenden, UnprocessableEntity bei nicht-published.
     */
    private async loadAndAssertBundles(bundleVersionIds: string[]): Promise<BundleVersionRow[]> {
        const result: BundleVersionRow[] = [];
        for (const id of bundleVersionIds) {
            const bv = await this.bundleRepo.findVersionById(id);
            if (!bv) {
                throw new UnprocessableEntityException(
                    `BundleVersion '${id}' nicht gefunden — BusinessTypeVersion kann nur published BundleVersions referenzieren`,
                );
            }
            if (bv.publishedAt === null) {
                throw new UnprocessableEntityException(
                    `BundleVersion '${id}' ist Draft — BusinessTypeVersion-Komposition braucht published Versionen`,
                );
            }
            result.push(bv);
        }
        return result;
    }

    private async runStrictCheck(
        draft: { businessTypeKey: string; quotaOverrides: Record<string, number> },
        bundleVersions: BundleVersionRow[],
    ): Promise<StrictModeWarning[]> {
        const snapshot = resolveDiscoverySnapshot(this.snapshot, this.scanner);
        if (!snapshot) {
            // Ohne Snapshot prüfen wir trotzdem Disjointness + Compatibility,
            // weil das nicht von Discovery abhängt — nur Quota-Overrides werden
            // übersprungen (inkl. Approved-Gate, das den Snapshot-projectKey braucht).
            return validateBusinessTypeDraft(draft, bundleVersions, {
                schemaVersion: 1,
                scannedAt: new Date().toISOString(),
                app: { key: 'unknown', version: '0.0.0' },
                capabilities: [],
                features: [],
                quotas: [],
                hash: 'sha256-empty',
            }).filter((w) => w.code !== 'QUOTA_MISSING');
        }
        // Approved-Gate (#20 Slice 5): projectKey == snapshot.app.key (Konvention).
        const approved = await loadApprovedCatalogKeys(this.catalogEntries, snapshot.app.key);
        return validateBusinessTypeDraft(draft, bundleVersions, snapshot, approved);
    }

    private gateOrPass(warnings: StrictModeWarning[]): void {
        if (warnings.length === 0) return;
        if (this.mode === 'blocking') {
            throw new UnprocessableEntityException({
                code: 'STRICT_MODE_VIOLATIONS',
                message: 'Strict-Mode-Check hat Drift gegen den Discovery-Snapshot gefunden.',
                warnings,
            });
        }
    }
}
