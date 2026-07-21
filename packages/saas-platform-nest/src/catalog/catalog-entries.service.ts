// CatalogEntriesService — discovery review workflow, feature-/quota-centric
// (#20, SPEC_V2 §6.3).
//
// Three entities: CapabilityCatalogEntry (read-only code fact),
// FeatureCatalogEntry and QuotaCatalogEntry (approval lifecycle
// pending → approved ↔ outdated · obsolete). The code (`/admin/discovery`)
// is the actual state; these tables hold approval + translations.
//
// `syncFromSnapshot` upserts from the discovery snapshot: new keys land
// as `pending`, missing ones become `obsolete` (capabilities: `retired`), an
// existing approval status is preserved. For `approved` entries
// the sync compares the persisted approval signature against the
// snapshot — on drift the status flips to `outdated`.

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
 * Allowed transitions of the approval state machine (#20, design sim):
 * approve/re-approve → `approved`, revoke approval/reactivate
 * → `pending`, manually mark as outdated/obsolete → `outdated`/`obsolete`.
 */
const REVIEW_TRANSITIONS: Record<DiscoveryStatus, readonly DiscoveryStatus[]> = {
    pending: ['approved', 'obsolete'],
    approved: ['pending', 'outdated', 'obsolete'],
    outdated: ['approved', 'pending', 'obsolete'],
    obsolete: ['pending'],
};

/**
 * Resolves the approval status during sync: new entries start `pending`,
 * existing ones keep their status. `obsolete` deliberately stays put, even
 * when the key reappears in the code — reactivating is a SuperAdmin
 * decision, not a sync automatism.
 */
function resolveReviewStatus(existing: DiscoveryStatus | undefined): DiscoveryStatus {
    return existing ?? 'pending';
}

/**
 * Drift detection (#20): an `approved` entry whose approval signature
 * no longer matches the current snapshot flips to `outdated`. Manually
 * set statuses (incl. manual `outdated`) remain untouched.
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
 * Successor index (#39): old key → sorted list of snapshot keys that
 * claim it via `replaces`. Multiple claimants are a code error
 * — the sync deterministically takes the lexicographically first and logs.
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
     * Mirrors the discovery snapshot into the catalog entries at boot
     * (discovery-as-SSOT, #12). Runs only when a snapshot is available and
     * the kill switch `autoSyncDiscoveryAtBoot` is not set to `false`. A
     * sync error deliberately does not abort the boot — the manual endpoint
     * `POST /admin/catalog/discovery/sync` remains as a fallback.
     */
    async onApplicationBootstrap(): Promise<void> {
        if (!this.autoSyncAtBoot) return;
        // #25: resolve the snapshot via token (Symbol.for → cross-bundle stable),
        // DiscoveryScanner as same-entry fallback. Before the Symbol.for fix the
        // token was a different Symbol cross-entry → auto-sync silently no-op'd.
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
     * Approval transition of a feature (#20). Validates the state machine;
     * `approved` persists the approval signature from the current
     * snapshot, `pending` (revoke/reactivate) deletes it, `outdated`/
     * `obsolete` keep the last approval as history.
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

    /** Approval transition of a quota — same state machine as features (#20). */
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
        // `pending` = revoke approval/reactivate → clear approval fields;
        // `outdated`/`obsolete` keep the last approval as history.
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

    /** Sets the editable default-locale label/description of a feature. */
    setFeatureBase(
        projectKey: string,
        featureKey: string,
        data: UpdateCatalogEntryBaseData,
    ): Promise<FeatureCatalogEntryRow> {
        return this.repo.setFeatureBase(projectKey, featureKey, data);
    }

    /** Sets the editable default-locale label/description of a quota. */
    setQuotaBase(
        projectKey: string,
        quotaKey: string,
        data: UpdateCatalogEntryBaseData,
    ): Promise<QuotaCatalogEntryRow> {
        return this.repo.setQuotaBase(projectKey, quotaKey, data);
    }

    /**
     * Synchronizes the catalog entries from a discovery snapshot.
     * Idempotent — can run against the same snapshot any number of times.
     */
    async syncFromSnapshot(snapshot: DiscoverySnapshot): Promise<SyncDiscoveryResult> {
        const projectKey = snapshot.app.key;
        const nowIso = new Date().toISOString();

        // ─── Capabilities (read-only code facts, #20) ───
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
            // #12: seed UI metadata from the curated registry — but ONLY into
            // empty fields; existing (SuperAdmin-maintained) values win, so that
            // FeatureCatalogEntry remains the editable SSOT.
            const meta = this.featureUiRegistry?.[feature.featureKey];
            // "Bare" = never curated: the label is the default (== key).
            // Only then seed from the registry — a real (≠ key) label counts as
            // SuperAdmin-/already-seeded and wins.
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
            // Icon is not in the upsertFeature input → separate (partial
            // setFeatureBase), likewise only when the DB has no icon yet.
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
     * `replaced` semantics (#39): if a key disappears from the snapshot AND
     * another snapshot key claims it via `replaces`, the old entry gets
     * the successor pointer — `obsolete` (from `retireMissing`)
     * + `successorKey` instead of a bare `obsolete`. If a key reappears in
     * the code, an existing pointer is deleted. A missing key
     * without a claimant remains untouched (deleted without replacement).
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
