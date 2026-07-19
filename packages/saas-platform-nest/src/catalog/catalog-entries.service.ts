// CatalogEntriesService — Discovery-Review-Workflow, feature-/quota-zentriert
// (#20, SPEC_V2 §6.3).
//
// Drei Entitäten: CapabilityCatalogEntry (read-only Code-Fakt),
// FeatureCatalogEntry und QuotaCatalogEntry (Freigabe-Lifecycle
// pending → approved ↔ outdated · obsolete). Der Code (`/admin/discovery`)
// ist der Ist-Zustand; diese Tabellen halten Freigabe + Übersetzungen.
//
// `syncFromSnapshot` upsertet aus dem Discovery-Snapshot: neue Keys landen
// als `pending`, fehlende werden `obsolete` (Capabilities: `retired`), ein
// vorhandener Freigabe-Status bleibt erhalten. Für `approved`-Einträge
// vergleicht der Sync die persistierte Approval-Signatur gegen den
// Snapshot — bei Drift kippt der Status auf `outdated`.
//
// Spec: yada-services/handoff/superadmin/SPEC_V2.md §6.3 + #20

import {
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
    UnprocessableEntityException,
    type OnApplicationBootstrap,
} from '@nestjs/common';
import type {
    CapabilityCatalogEntryRow,
    CapabilityCodeStatus,
    CatalogEntryI18n,
    CatalogEntryRepository,
    DiscoveredFeature,
    DiscoveredQuota,
    DiscoverySnapshot,
    DiscoveryStatus,
    FeatureCatalogEntryRow,
    FeatureUiRegistry,
    QuotaCatalogEntryRow,
    ReviewCatalogEntryData,
    SetCatalogEntryReviewData,
    SyncDiscoveryResult,
    UpdateCatalogEntryBaseData,
} from '@saasicat/types';

import { DISCOVERY_SNAPSHOT_TOKEN } from '../discovery/tokens.js';
import { DiscoveryScanner } from '../discovery/discovery.scanner.js';
import { resolveDiscoverySnapshot } from '../core/discovery-snapshot-source.js';
import { featureApprovalSignature, quotaApprovalSignature } from './approval-signature.js';
import type { CatalogServiceConfig } from './bundles.service.js';
import {
    CATALOG_ENTRY_REPOSITORY_TOKEN,
    CATALOG_SERVICE_CONFIG_TOKEN,
    FEATURE_UI_REGISTRY_TOKEN,
} from './tokens.js';

/**
 * Erlaubte Übergänge des Freigabe-Automaten (#20, Design-Sim):
 * Freigeben/erneut freigeben → `approved`, Freigabe entziehen/Reaktivieren
 * → `pending`, manuell als veraltet/obsolet markieren → `outdated`/`obsolete`.
 */
const REVIEW_TRANSITIONS: Record<DiscoveryStatus, readonly DiscoveryStatus[]> = {
    pending: ['approved', 'obsolete'],
    approved: ['pending', 'outdated', 'obsolete'],
    outdated: ['approved', 'pending', 'obsolete'],
    obsolete: ['pending'],
};

/**
 * Löst den Freigabe-Status beim Sync auf: neue Einträge starten `pending`,
 * vorhandene behalten ihren Status. `obsolete` bleibt bewusst stehen, auch
 * wenn der Key wieder im Code auftaucht — Reaktivieren ist eine SuperAdmin-
 * Entscheidung, kein Sync-Automatismus.
 */
function resolveReviewStatus(existing: DiscoveryStatus | undefined): DiscoveryStatus {
    return existing ?? 'pending';
}

/**
 * Drift-Erkennung (#20): ein `approved`-Eintrag, dessen Approval-Signatur
 * nicht mehr zum aktuellen Snapshot passt, kippt auf `outdated`. Manuell
 * gesetzte Status (inkl. manuelles `outdated`) bleiben unangetastet.
 */
function withDrift(
    resolved: DiscoveryStatus,
    approvedSignature: string | null | undefined,
    currentSignature: string,
): DiscoveryStatus {
    if (resolved !== 'approved') return resolved;
    if (approvedSignature == null) return resolved;
    return approvedSignature === currentSignature ? resolved : 'outdated';
}

/**
 * Nachfolger-Index (#39): alter Key → sortierte Liste der Snapshot-Keys, die
 * ihn via `replaces` beanspruchen. Mehrere Beansprucher sind ein Code-Fehler
 * — der Sync nimmt deterministisch den lexikografisch ersten und loggt.
 */
function buildSuccessorIndex(
    entries: readonly { key: string; replaces: string[] | null | undefined }[],
): Map<string, string[]> {
    const claimants = new Map<string, string[]>();
    for (const entry of entries) {
        for (const oldKey of entry.replaces ?? []) {
            if (oldKey === entry.key) continue;
            const list = claimants.get(oldKey) ?? [];
            list.push(entry.key);
            claimants.set(oldKey, list);
        }
    }
    for (const list of claimants.values()) list.sort((a, b) => a.localeCompare(b));
    return claimants;
}

@Injectable()
export class CatalogEntriesService implements OnApplicationBootstrap {
    private readonly logger = new Logger(CatalogEntriesService.name);
    private readonly autoSyncAtBoot: boolean;

    constructor(
        @Inject(CATALOG_ENTRY_REPOSITORY_TOKEN)
        private readonly repo: CatalogEntryRepository,
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
        @Inject(FEATURE_UI_REGISTRY_TOKEN)
        private readonly featureUiRegistry: FeatureUiRegistry | null = null,
    ) {
        this.autoSyncAtBoot = config.autoSyncDiscoveryAtBoot ?? true;
    }

    /**
     * Spiegelt beim Boot den Discovery-Snapshot in die Catalog-Entries
     * (Discovery-als-SSOT, #12). Läuft nur, wenn ein Snapshot bereitsteht und
     * der Kill-Switch `autoSyncDiscoveryAtBoot` nicht auf `false` steht. Ein
     * Sync-Fehler bricht den Boot bewusst nicht ab — der manuelle Endpoint
     * `POST /admin/catalog/discovery/sync` bleibt als Fallback.
     */
    async onApplicationBootstrap(): Promise<void> {
        if (!this.autoSyncAtBoot) return;
        // #25: Snapshot via Token (Symbol.for → cross-bundle-stabil) auflösen,
        // DiscoveryScanner als Same-Entry-Fallback. Vor dem Symbol.for-Fix war
        // der Token cross-entry ein anderes Symbol → Auto-Sync no-op'te still.
        const snapshot = resolveDiscoverySnapshot(this.snapshot, this.scanner);
        if (!snapshot) {
            this.logger.warn(
                'Discovery-Auto-Sync übersprungen: kein Snapshot (weder Token noch ' +
                    'DiscoveryScanner injiziert). DiscoveryModule wiren (#25).',
            );
            return;
        }
        try {
            const result = await this.syncFromSnapshot(snapshot);
            this.logger.log(
                `Discovery-Auto-Sync (${snapshot.app.key}): ` +
                    `Features ${result.features.discovered}↑/${result.features.retired}↓/${result.features.outdated}⚠, ` +
                    `Quotas ${result.quotas.discovered}↑/${result.quotas.retired}↓/${result.quotas.outdated}⚠, ` +
                    `Capabilities ${result.capabilities.discovered}↑/${result.capabilities.retired}↓`,
            );
        } catch (err) {
            this.logger.error(
                `Discovery-Auto-Sync beim Boot fehlgeschlagen (${snapshot.app.key}) — ` +
                    'Katalog ggf. veraltet; manuell via POST /admin/catalog/discovery/sync nachziehen',
                err instanceof Error ? err.stack : String(err),
            );
        }
    }

    listCapabilities(
        projectKey: string,
        codeStatus?: string,
    ): Promise<CapabilityCatalogEntryRow[]> {
        return this.repo.listCapabilities({
            projectKey,
            codeStatus: codeStatus as CapabilityCodeStatus | undefined,
        });
    }

    listFeatures(projectKey: string, discoveryStatus?: string): Promise<FeatureCatalogEntryRow[]> {
        return this.repo.listFeatures({
            projectKey,
            discoveryStatus: discoveryStatus as DiscoveryStatus | undefined,
        });
    }

    listQuotas(projectKey: string, discoveryStatus?: string): Promise<QuotaCatalogEntryRow[]> {
        return this.repo.listQuotas({
            projectKey,
            discoveryStatus: discoveryStatus as DiscoveryStatus | undefined,
        });
    }

    /**
     * Freigabe-Übergang eines Features (#20). Validiert den Automaten;
     * `approved` persistiert die Approval-Signatur aus dem aktuellen
     * Snapshot, `pending` (entziehen/reaktivieren) löscht sie, `outdated`/
     * `obsolete` behalten die letzte Freigabe als Historie.
     */
    async reviewFeature(
        projectKey: string,
        featureKey: string,
        data: ReviewCatalogEntryData,
        reviewedBy: string | null,
    ): Promise<FeatureCatalogEntryRow> {
        const existing = await this.repo.findFeature(projectKey, featureKey);
        if (!existing) {
            throw new NotFoundException(
                `Feature '${featureKey}' in Projekt '${projectKey}' nicht gefunden`,
            );
        }
        return this.repo.setFeatureReview(
            projectKey,
            featureKey,
            this.resolveReviewUpdate(existing, data.discoveryStatus, reviewedBy, (snapshot) =>
                featureApprovalSignature(featureKey, snapshot),
            ),
        );
    }

    /** Freigabe-Übergang einer Quota — gleicher Automat wie Features (#20). */
    async reviewQuota(
        projectKey: string,
        quotaKey: string,
        data: ReviewCatalogEntryData,
        reviewedBy: string | null,
    ): Promise<QuotaCatalogEntryRow> {
        const existing = await this.repo.findQuota(projectKey, quotaKey);
        if (!existing) {
            throw new NotFoundException(
                `Quota '${quotaKey}' in Projekt '${projectKey}' nicht gefunden`,
            );
        }
        return this.repo.setQuotaReview(
            projectKey,
            quotaKey,
            this.resolveReviewUpdate(existing, data.discoveryStatus, reviewedBy, (snapshot) => {
                const discovered = snapshot.quotas.find((q) => q.quotaKey === quotaKey);
                if (!discovered) {
                    throw new UnprocessableEntityException(
                        `Quota '${quotaKey}' ist nicht im Discovery-Snapshot — eine nicht im Code deklarierte Quota kann nicht freigegeben werden`,
                    );
                }
                return quotaApprovalSignature(discovered);
            }),
        );
    }

    private resolveReviewUpdate(
        existing: Pick<
            FeatureCatalogEntryRow,
            'discoveryStatus' | 'approvedAt' | 'approvedBy' | 'approvedSignature'
        >,
        target: DiscoveryStatus,
        reviewedBy: string | null,
        signatureOf: (snapshot: DiscoverySnapshot) => string,
    ): SetCatalogEntryReviewData {
        if (!REVIEW_TRANSITIONS[existing.discoveryStatus].includes(target)) {
            throw new UnprocessableEntityException(
                `Übergang '${existing.discoveryStatus}' → '${target}' ist nicht erlaubt`,
            );
        }
        if (target === 'approved') {
            const snapshot = resolveDiscoverySnapshot(this.snapshot, this.scanner);
            if (!snapshot) {
                throw new UnprocessableEntityException(
                    'Freigabe braucht einen Discovery-Snapshot — Discovery ist nicht initialisiert (#25)',
                );
            }
            return {
                discoveryStatus: 'approved',
                approvedAt: new Date().toISOString(),
                approvedBy: reviewedBy,
                approvedSignature: signatureOf(snapshot),
            };
        }
        // `pending` = Freigabe entziehen/Reaktivieren → Approval-Felder löschen;
        // `outdated`/`obsolete` behalten die letzte Freigabe als Historie.
        const keepApproval = target !== 'pending';
        return {
            discoveryStatus: target,
            approvedAt: keepApproval ? existing.approvedAt : null,
            approvedBy: keepApproval ? existing.approvedBy : null,
            approvedSignature: keepApproval ? existing.approvedSignature : null,
        };
    }

    setFeatureI18n(
        projectKey: string,
        featureKey: string,
        i18n: CatalogEntryI18n,
    ): Promise<FeatureCatalogEntryRow> {
        return this.repo.setFeatureI18n(projectKey, featureKey, i18n);
    }

    setQuotaI18n(
        projectKey: string,
        quotaKey: string,
        i18n: CatalogEntryI18n,
    ): Promise<QuotaCatalogEntryRow> {
        return this.repo.setQuotaI18n(projectKey, quotaKey, i18n);
    }

    /** Setzt das editierbare Default-Locale-Label/-Beschreibung eines Features. */
    setFeatureBase(
        projectKey: string,
        featureKey: string,
        data: UpdateCatalogEntryBaseData,
    ): Promise<FeatureCatalogEntryRow> {
        return this.repo.setFeatureBase(projectKey, featureKey, data);
    }

    /** Setzt das editierbare Default-Locale-Label/-Beschreibung einer Quota. */
    setQuotaBase(
        projectKey: string,
        quotaKey: string,
        data: UpdateCatalogEntryBaseData,
    ): Promise<QuotaCatalogEntryRow> {
        return this.repo.setQuotaBase(projectKey, quotaKey, data);
    }

    /**
     * Synchronisiert die Catalog-Entries aus einem Discovery-Snapshot.
     * Idempotent — kann beliebig oft gegen denselben Snapshot laufen.
     */
    async syncFromSnapshot(snapshot: DiscoverySnapshot): Promise<SyncDiscoveryResult> {
        const projectKey = snapshot.app.key;
        const nowIso = new Date().toISOString();

        // ─── Capabilities (read-only Code-Fakten, #20) ───
        const existingCaps = await this.repo.listCapabilities({ projectKey });
        const capByKey = new Map(existingCaps.map((c) => [c.capabilityKey, c]));
        const presentCaps: string[] = [];
        let capDiscovered = 0;
        for (const cap of snapshot.capabilities) {
            if (cap.status === 'internal') continue;
            presentCaps.push(cap.capabilityKey);
            const existing = capByKey.get(cap.capabilityKey);
            if (!existing || existing.codeStatus === 'retired') capDiscovered++;
            await this.repo.upsertCapability({
                projectKey,
                capabilityKey: cap.capabilityKey,
                label: cap.label ?? cap.capabilityKey,
                description: existing?.description ?? null,
                featureKey: cap.feature,
                bundleKey: existing?.bundleKey ?? null,
                codeStatus: cap.status,
                owner: cap.owner,
                kind: cap.kind,
                replacementKey: cap.replacementKey ?? existing?.replacementKey ?? null,
                deprecatedAt:
                    cap.status === 'deprecated'
                        ? (existing?.deprecatedAt ?? nowIso)
                        : (existing?.deprecatedAt ?? null),
                removalPlannedAt: cap.removalPlannedAt ?? existing?.removalPlannedAt ?? null,
                reason: cap.reason ?? existing?.reason ?? null,
            });
        }
        const capRetired = await this.repo.retireMissing(projectKey, 'capability', presentCaps);

        // ─── Features ───
        const existingFeatures = await this.repo.listFeatures({ projectKey });
        const featureByKey = new Map(existingFeatures.map((f) => [f.featureKey, f]));
        const presentFeatures: string[] = [];
        let featureDiscovered = 0;
        let featureOutdated = 0;
        for (const feature of snapshot.features) {
            presentFeatures.push(feature.featureKey);
            const existing = featureByKey.get(feature.featureKey);
            if (!existing) featureDiscovered++;
            const resolved = withDrift(
                resolveReviewStatus(existing?.discoveryStatus),
                existing?.approvedSignature,
                featureApprovalSignature(feature.featureKey, snapshot),
            );
            if (resolved === 'outdated' && existing?.discoveryStatus === 'approved') {
                featureOutdated++;
            }
            // #12: UI-Metadaten aus der kuratierten Registry seeden — aber NUR in
            // leere Felder; vorhandene (SuperAdmin-gepflegte) Werte gewinnen, damit
            // FeatureCatalogEntry die editierbare SSOT bleibt.
            const meta = this.featureUiRegistry?.[feature.featureKey];
            // „Bare" = noch nie kuratiert: das Label ist der Default (== Key).
            // Nur dann aus der Registry seeden — ein echtes (≠ Key) Label gilt als
            // SuperAdmin-/bereits-geseedet und gewinnt.
            const hasCuratedLabel = existing != null && existing.label !== feature.featureKey;
            await this.repo.upsertFeature({
                projectKey,
                featureKey: feature.featureKey,
                label: hasCuratedLabel ? existing.label : (meta?.label ?? feature.featureKey),
                description: existing?.description ?? meta?.description ?? null,
                discoveryStatus: resolved,
                requires: feature.requires ?? [],
                replaces: feature.replaces ?? [],
                core: meta?.core ?? false,
            });
            // Icon liegt nicht im upsertFeature-Input → separat (partielles
            // setFeatureBase), ebenfalls nur wenn die DB noch kein Icon hat.
            if (meta?.icon && !existing?.icon) {
                await this.repo.setFeatureBase(projectKey, feature.featureKey, {
                    icon: meta.icon,
                });
            }
        }
        const featureRetired = await this.repo.retireMissing(
            projectKey,
            'feature',
            presentFeatures,
        );
        const featureReplaced = await this.applySuccessorPointers(
            'feature',
            projectKey,
            existingFeatures.map((f) => ({ key: f.featureKey, successorKey: f.successorKey })),
            new Set(presentFeatures),
            buildSuccessorIndex(
                snapshot.features.map((f: DiscoveredFeature) => ({
                    key: f.featureKey,
                    replaces: f.replaces,
                })),
            ),
        );

        // ─── Quotas ───
        const existingQuotas = await this.repo.listQuotas({ projectKey });
        const quotaByKey = new Map(existingQuotas.map((q) => [q.quotaKey, q]));
        const presentQuotas: string[] = [];
        let quotaDiscovered = 0;
        let quotaOutdated = 0;
        for (const quota of snapshot.quotas) {
            presentQuotas.push(quota.quotaKey);
            const existing = quotaByKey.get(quota.quotaKey);
            if (!existing) quotaDiscovered++;
            const resolved = withDrift(
                resolveReviewStatus(existing?.discoveryStatus),
                existing?.approvedSignature,
                quotaApprovalSignature(quota),
            );
            if (resolved === 'outdated' && existing?.discoveryStatus === 'approved') {
                quotaOutdated++;
            }
            await this.repo.upsertQuota({
                projectKey,
                quotaKey: quota.quotaKey,
                label: quota.label,
                description: existing?.description ?? null,
                unit: quota.unit,
                featureKey: quota.feature,
                usageProvider: quota.declaredAt || null,
                enforcementMode: quota.policy === 'hardCap' ? 'hard' : 'soft',
                discoveryStatus: resolved,
                replaces: quota.replaces ?? [],
            });
        }
        const quotaRetired = await this.repo.retireMissing(projectKey, 'quota', presentQuotas);
        const quotaReplaced = await this.applySuccessorPointers(
            'quota',
            projectKey,
            existingQuotas.map((q) => ({ key: q.quotaKey, successorKey: q.successorKey })),
            new Set(presentQuotas),
            buildSuccessorIndex(
                snapshot.quotas.map((q: DiscoveredQuota) => ({
                    key: q.quotaKey,
                    replaces: q.replaces,
                })),
            ),
        );

        return {
            capabilities: {
                discovered: capDiscovered,
                retired: capRetired,
                total: presentCaps.length,
            },
            features: {
                discovered: featureDiscovered,
                retired: featureRetired,
                outdated: featureOutdated,
                replaced: featureReplaced,
                total: presentFeatures.length,
            },
            quotas: {
                discovered: quotaDiscovered,
                retired: quotaRetired,
                outdated: quotaOutdated,
                replaced: quotaReplaced,
                total: presentQuotas.length,
            },
        };
    }

    /**
     * `replaced`-Semantik (#39): verschwindet ein Key aus dem Snapshot UND
     * beansprucht ein anderer Snapshot-Key ihn via `replaces`, bekommt der
     * alte Eintrag den Nachfolger-Pointer — `obsolete` (aus `retireMissing`)
     * + `successorKey` statt nacktem `obsolete`. Taucht ein Key wieder im
     * Code auf, wird ein vorhandener Pointer gelöscht. Ein fehlender Key
     * ohne Beansprucher bleibt unangetastet (gelöscht ohne Ersatz).
     */
    private async applySuccessorPointers(
        type: 'feature' | 'quota',
        projectKey: string,
        existing: readonly { key: string; successorKey: string | null | undefined }[],
        presentKeys: ReadonlySet<string>,
        claimantsByOldKey: ReadonlyMap<string, string[]>,
    ): Promise<number> {
        const changes: { key: string; successorKey: string | null }[] = [];
        for (const entry of existing) {
            const current = entry.successorKey ?? null;
            let target = current;
            if (presentKeys.has(entry.key)) {
                target = null;
            } else {
                const claimants = claimantsByOldKey.get(entry.key);
                if (claimants && claimants.length > 0) {
                    if (claimants.length > 1) {
                        this.logger.warn(
                            `${type} '${entry.key}' wird von mehreren replaces-Deklarationen beansprucht ` +
                                `(${claimants.join(', ')}); '${claimants[0]}' gewinnt — replaces im Code bereinigen (#39)`,
                        );
                    }
                    target = claimants[0];
                }
            }
            if (target !== current) changes.push({ key: entry.key, successorKey: target });
        }
        if (changes.length === 0) return 0;

        const setSuccessor =
            type === 'feature'
                ? this.repo.setFeatureSuccessor?.bind(this.repo)
                : this.repo.setQuotaSuccessor?.bind(this.repo);
        if (!setSuccessor) {
            this.logger.warn(
                `CatalogEntryRepository implementiert set${type === 'feature' ? 'Feature' : 'Quota'}Successor ` +
                    `nicht — ${changes.length} Nachfolger-Pointer (#39) werden nicht persistiert`,
            );
            return 0;
        }
        let replaced = 0;
        for (const change of changes) {
            await setSuccessor(projectKey, change.key, change.successorKey);
            if (change.successorKey !== null) replaced++;
        }
        return replaced;
    }
}
