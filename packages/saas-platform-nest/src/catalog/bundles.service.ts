// BundlesService — CRUD for `bundles` + `bundle_versions`.
//
// Wires together the Repository (persistence) + discovery snapshot (code
// validation) + version diff (contract-protection P3 classification).
// Mutating operations on BundleVersion return `BundleVersionMutationResult`
// with warnings for the UI; hard errors (e.g. duplicate `bundleKey`,
// NotFound) throw HttpException.
//
// In warn-only mode (`STRICT_CATALOG_CHECK_MODE = 'warn-only'`, see
// SPEC_V2 §8.1) strict-mode violations pass through as a `warnings` list;
// in blocking mode the service instead throws HTTP 422 with the same
// warning list as the body. Default: blocking (#12). Exception: broken
// `compatibility.planIds` always block once a PlanRepository is registered
// for the existence check.

import {
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
    UnprocessableEntityException,
} from '@nestjs/common';
import {
    CATALOG_ERROR_CODES,
    isVersionEditable,
    type BundleCompatibility,
    type BundleRepository,
    type BundleRow,
    type BundleVersionMutationResult,
    type BundleVersionRow,
    type CatalogEntryRepository,
    type CreateBundleData,
    type CreateBundleVersionDraftData,
    type DiscoverySnapshot,
    type PlanRepository,
    type PublishBundleVersionData,
    type StrictModeWarning,
    type SubscriptionRepository,
    type UpdateBundleData,
    type UpdateBundleVersionDraftData,
} from '@saasicat/types';

import { classifyBundleVersionDiff } from '../billing/version-diff.js';
import { DISCOVERY_SNAPSHOT_TOKEN } from '../discovery/tokens.js';
import { DiscoveryScanner } from '../discovery/discovery.scanner.js';
import {
    hasDiscoverySnapshotSource,
    resolveDiscoverySnapshot,
} from '../core/discovery-snapshot-source.js';
import { SUBSCRIPTION_REPOSITORY_TOKEN } from '../entitlement/tokens.js';
import {
    BUNDLE_REPOSITORY_TOKEN,
    CATALOG_ENTRY_REPOSITORY_TOKEN,
    CATALOG_SERVICE_CONFIG_TOKEN,
    PLAN_REPOSITORY_TOKEN,
} from './tokens.js';
import { loadApprovedCatalogKeys } from './approved-keys.js';
import { blockingStrictModeWarnings, validateBundleDraft } from './strict-mode-check.js';

/**
 * Configuration for the mutating operations.
 */
export interface CatalogServiceConfig {
    /** Active mode for the strict-mode check. Default `'blocking'` (#12). */
    strictModeCheckMode?: 'warn-only' | 'blocking';
    /**
     * Discovery→Catalog auto-sync at boot (#12). Default `true` — runs when a
     * `DiscoverySnapshot` is available. Set to `false` to disable the boot
     * sync; the manual `POST /admin/catalog/discovery/sync` is unaffected.
     */
    autoSyncDiscoveryAtBoot?: boolean;
    /**
     * Feature keys the catalog is deliberately allowed to carry WITHOUT them
     * existing in the discovery snapshot (= in code via @ImplementsCapability) —
     * marketed non-code features such as support SLAs (e.g. PRIORITY_SUPPORT).
     * The strict-mode check does NOT report them as BUNDLE_/PLAN_FEATURE_UNKNOWN.
     * Use sparingly: this is the only legitimate exception to "code is the
     * source of truth"; not-yet-built features do NOT belong here but should be
     * removed from the catalog until they are implemented.
     */
    marketedOnlyFeatures?: string[];
}

@Injectable()
export class BundlesService {
    private readonly logger = new Logger(BundlesService.name);
    private mode: 'warn-only' | 'blocking';
    private readonly marketedOnly: ReadonlySet<string>;

    constructor(
        @Inject(BUNDLE_REPOSITORY_TOKEN)
        private readonly repo: BundleRepository,
        @Optional()
        @Inject(DISCOVERY_SNAPSHOT_TOKEN)
        private readonly snapshot: DiscoverySnapshot | null = null,
        @Optional()
        @Inject(CATALOG_SERVICE_CONFIG_TOKEN)
        config: CatalogServiceConfig = {},
        @Optional()
        @Inject(SUBSCRIPTION_REPOSITORY_TOKEN)
        private readonly subscriptions: SubscriptionRepository | null = null,
        @Optional()
        @Inject(PLAN_REPOSITORY_TOKEN)
        private readonly planRepo: PlanRepository | null = null,
        @Optional()
        @Inject(DiscoveryScanner)
        private readonly scanner: DiscoveryScanner | null = null,
        @Optional()
        @Inject(CATALOG_ENTRY_REPOSITORY_TOKEN)
        private readonly catalogEntries: CatalogEntryRepository | null = null,
    ) {
        this.mode = config.strictModeCheckMode ?? 'blocking';
        this.marketedOnly = new Set(config.marketedOnlyFeatures ?? []);
        // #25: blocking needs a snapshot source (injected token OR
        // DiscoveryScanner). If both are missing, do NOT crash (that caused a
        // prod outage) — log loudly + degrade to warn-only.
        if (this.mode === 'blocking' && !hasDiscoverySnapshotSource(this.snapshot, this.scanner)) {
            this.logger.error(
                'BundlesService: strictModeCheckMode=blocking without a DiscoverySnapshot source — ' +
                    'degrading to warn-only. Wire DiscoveryModule so that enforcement takes effect (#25).',
            );
            this.mode = 'warn-only';
        }
    }

    // =========================================================================
    // Master operations
    // =========================================================================

    listBundles(projectKey: string): Promise<BundleRow[]> {
        return this.repo.list({ projectKey, excludeDeleted: true });
    }

    async getBundle(
        bundleId: string,
    ): Promise<{ bundle: BundleRow; versions: BundleVersionRow[] }> {
        const bundle = await this.repo.findById(bundleId);
        if (!bundle) {
            throw new NotFoundException({
                code: CATALOG_ERROR_CODES.BUNDLE_NOT_FOUND,
                message: `Bundle '${bundleId}' not found`,
                params: { bundleId },
            });
        }
        const versions = await this.annotateEditability(await this.repo.listVersions(bundleId));
        return { bundle, versions };
    }

    async createBundle(data: CreateBundleData): Promise<BundleRow> {
        const existing = await this.repo.findByKey(data.projectKey, data.bundleKey);
        if (existing) {
            throw new UnprocessableEntityException({
                code: CATALOG_ERROR_CODES.BUNDLE_ALREADY_EXISTS,
                message: `Bundle '${data.bundleKey}' already exists in project '${data.projectKey}'`,
                params: { bundleKey: data.bundleKey, projectKey: data.projectKey },
            });
        }
        return this.repo.create(data);
    }

    async updateBundle(bundleId: string, data: UpdateBundleData): Promise<BundleRow> {
        const existing = await this.repo.findById(bundleId);
        if (!existing) {
            throw new NotFoundException({
                code: CATALOG_ERROR_CODES.BUNDLE_NOT_FOUND,
                message: `Bundle '${bundleId}' not found`,
                params: { bundleId },
            });
        }
        return this.repo.update(bundleId, data);
    }

    async softDeleteBundle(bundleId: string): Promise<void> {
        const existing = await this.repo.findById(bundleId);
        if (!existing) {
            throw new NotFoundException({
                code: CATALOG_ERROR_CODES.BUNDLE_NOT_FOUND,
                message: `Bundle '${bundleId}' not found`,
                params: { bundleId },
            });
        }
        if (existing.deletedAt !== null) return; // idempotent
        await this.repo.softDelete(bundleId);
    }

    /**
     * Hard-deletes a draft BundleVersion (`publishedAt === null`) from the
     * DB. Published versions stay immutable (contract-protection P1) — the
     * service throws 422 with code `BUNDLE_VERSION_ALREADY_PUBLISHED`.
     */
    async discardBundleDraft(versionId: string): Promise<void> {
        const existing = await this.repo.findVersionById(versionId);
        if (!existing) {
            throw new NotFoundException({
                code: CATALOG_ERROR_CODES.BUNDLE_VERSION_NOT_FOUND,
                message: `BundleVersion '${versionId}' not found`,
                params: { versionId },
            });
        }
        if (existing.publishedAt !== null) {
            throw new UnprocessableEntityException({
                code: CATALOG_ERROR_CODES.BUNDLE_VERSION_ALREADY_PUBLISHED,
                message: `BundleVersion '${versionId}' is already published and cannot be discarded.`,
                params: { versionId },
            });
        }
        if (typeof this.repo.deleteDraft !== 'function') {
            throw new UnprocessableEntityException({
                code: CATALOG_ERROR_CODES.BUNDLE_VERSION_DISCARD_NOT_IMPLEMENTED,
                message:
                    'Discard is not implemented in the current repository. ' +
                    'Implement BundleRepository.deleteDraft.',
            });
        }
        await this.repo.deleteDraft(versionId);
    }

    // =========================================================================
    // Version operations
    // =========================================================================

    async listBundleVersions(bundleId: string): Promise<BundleVersionRow[]> {
        return this.annotateEditability(await this.repo.listVersions(bundleId));
    }

    async getBundleVersion(versionId: string): Promise<BundleVersionRow> {
        const version = await this.repo.findVersionById(versionId);
        if (!version) {
            throw new NotFoundException({
                code: CATALOG_ERROR_CODES.BUNDLE_VERSION_NOT_FOUND,
                message: `BundleVersion '${versionId}' not found`,
                params: { versionId },
            });
        }
        const [annotated] = await this.annotateEditability([version]);
        return annotated;
    }

    /**
     * Annotates each BundleVersion with `isLatestInChain` (highest version
     * number in the chain) + `subscriptionCount` so that UI and backend make
     * the same editability decision. `subscriptionCount` stays `undefined`
     * when no SubscriptionRepository is registered or the method was not
     * implemented — `isVersionEditable` interprets that fail-closed
     * (= frozen).
     */
    private async annotateEditability(versions: BundleVersionRow[]): Promise<BundleVersionRow[]> {
        if (versions.length === 0) return versions;
        let maxVersion = -Infinity;
        for (const v of versions) {
            if (v.version > maxVersion) maxVersion = v.version;
        }
        const counter = this.subscriptions?.countByBundleVersionId?.bind(this.subscriptions);
        return Promise.all(
            versions.map(async (v) => {
                const isLatestInChain = v.version === maxVersion;
                const subscriptionCount =
                    counter && isLatestInChain && v.publishedAt !== null && v.supersededAt === null
                        ? await counter(v.id)
                        : undefined;
                return { ...v, isLatestInChain, subscriptionCount };
            }),
        );
    }

    /**
     * Creates a new draft BundleVersion. Throws when a draft already exists
     * for the same bundle (repository constraint).
     *
     * The strict-mode check runs on the input; in `warn-only` warnings are
     * returned, in `blocking` the service throws HTTP 422.
     */
    async createBundleDraft(
        data: CreateBundleVersionDraftData,
    ): Promise<BundleVersionMutationResult> {
        const bundle = await this.repo.findById(data.bundleId);
        if (!bundle) {
            throw new NotFoundException({
                code: CATALOG_ERROR_CODES.BUNDLE_NOT_FOUND,
                message: `Bundle '${data.bundleId}' not found`,
                params: { bundleId: data.bundleId },
            });
        }

        const existingDraft = await this.repo.findCurrentDraft(data.bundleId);
        if (existingDraft) {
            throw new UnprocessableEntityException({
                code: CATALOG_ERROR_CODES.BUNDLE_DRAFT_ALREADY_EXISTS,
                message: `Bundle '${bundle.bundleKey}' already has a draft version v${existingDraft.version}; publish or discard it first`,
                params: { bundleKey: bundle.bundleKey, draftVersion: existingDraft.version },
            });
        }

        // baseVersionId default: latest live (or null for v1)
        if (data.baseVersionId === undefined) {
            const latestLive = await this.repo.findLatestLive(data.bundleId);
            data = { ...data, baseVersionId: latestLive?.id ?? null };
        }

        const warnings = await this.runStrictCheck(
            {
                features: data.features,
                quotas: data.quotas ?? {},
                compatibility: data.compatibility,
            },
            bundle.projectKey,
        );
        this.gateOrPass(warnings);

        const bundleVersion = await this.repo.createDraft(data);
        return { bundleVersion, warnings };
    }

    /**
     * Updates a draft version or — as a deliberate relaxation of
     * contract-protection P1 — a published-but-future BundleVersion that is
     * latest-in-chain and does not yet bind any subscription. Once
     * `validFrom` is reached or a booking references it, the version freezes
     * again. The concrete decision is made by the `isVersionEditable` helper,
     * which is mirrored by the UI.
     */
    async updateBundleDraft(
        versionId: string,
        data: UpdateBundleVersionDraftData,
    ): Promise<BundleVersionMutationResult> {
        const existing = await this.repo.findVersionById(versionId);
        if (!existing) {
            throw new NotFoundException({
                code: CATALOG_ERROR_CODES.BUNDLE_VERSION_NOT_FOUND,
                message: `BundleVersion '${versionId}' not found`,
                params: { versionId },
            });
        }

        const [annotated] = await this.annotateEditability([existing]);
        const { editable } = isVersionEditable(annotated);
        if (!editable) {
            throw new UnprocessableEntityException({
                code: CATALOG_ERROR_CODES.BUNDLE_VERSION_NOT_EDITABLE,
                message:
                    `BundleVersion '${versionId}' is not editable. ` +
                    'Only drafts and published versions are editable that are latest-in-chain, ' +
                    'bind no subscription yet, and whose validFrom lies in the future.',
                params: { versionId },
            });
        }

        const merged = {
            features: data.features ?? existing.features,
            quotas: data.quotas ?? existing.quotas,
            compatibility: data.compatibility ?? existing.compatibility,
        };
        const bundle = await this.repo.findById(existing.bundleId);
        const warnings = await this.runStrictCheck(merged, bundle?.projectKey ?? null);
        this.gateOrPass(warnings);
        await this.assertBundleVersionWindowUpdate(existing, data);

        const bundleVersion = await this.repo.updateDraft(versionId, data);
        return { bundleVersion, warnings };
    }

    /**
     * Publishes a draft version atomically. Steps:
     * 1. Strict check on the draft definition (warn-only or blocking)
     * 2. Enforce validFrom requirement + ordering against the predecessor
     *    (SPEC_V2 §4.2 + §11.1 M6 Pack 2c, analogous to PlanVersion)
     * 3. Compute the diff against the predecessor version (latest live) →
     *    `publishedChanges` + `nonRegressive` via `classifyBundleVersionDiff`
     * 4. Call Repository.publishDraft with the diff result + validity dates
     *    (transaction; auto-succession sets the previous validUntil)
     */
    async publishBundleVersion(
        versionId: string,
        publishMeta: PublishBundleVersionData,
    ): Promise<BundleVersionMutationResult> {
        const draft = await this.repo.findVersionById(versionId);
        if (!draft) {
            throw new NotFoundException({
                code: CATALOG_ERROR_CODES.BUNDLE_VERSION_NOT_FOUND,
                message: `BundleVersion '${versionId}' not found`,
                params: { versionId },
            });
        }
        if (draft.publishedAt !== null) {
            throw new UnprocessableEntityException({
                code: CATALOG_ERROR_CODES.BUNDLE_VERSION_ALREADY_PUBLISHED,
                message: `BundleVersion '${versionId}' is already published`,
                params: { versionId },
            });
        }

        const bundle = await this.repo.findById(draft.bundleId);
        const warnings = await this.runStrictCheck(
            {
                features: draft.features,
                quotas: draft.quotas,
                compatibility: draft.compatibility,
            },
            bundle?.projectKey ?? null,
        );
        this.gateOrPass(warnings);

        // ─── Price gate (guards against accidentally publishing seed placeholders) ───
        // Bundle prices may be null (override resolution) — only an EXPLICIT
        // 0.00 value is suspicious (seed draft). Special case: allowZeroPrice: true.
        if (!publishMeta.allowZeroPrice) {
            const explicitZero = (v: string | null | undefined): boolean =>
                v !== null && v !== undefined && Number.parseFloat(String(v)) <= 0;
            if (explicitZero(draft.monthlyNet) || explicitZero(draft.yearlyNet)) {
                throw new UnprocessableEntityException({
                    code: CATALOG_ERROR_CODES.BUNDLE_VERSION_ZERO_PRICE,
                    message:
                        'A bundle version cannot be published with an explicit price of 0.00 (guard ' +
                        'against seed placeholders). For free bundles leave it null, or set allowZeroPrice.',
                    monthlyNet: draft.monthlyNet,
                    yearlyNet: draft.yearlyNet,
                });
            }
        }

        const previous = await this.repo.findLatestLive(draft.bundleId);

        // ─── validFrom (required on publish, SPEC_V2 §4.2) ───
        const validFromInput = publishMeta.validFrom ?? draft.validFrom;
        if (!validFromInput) {
            throw new UnprocessableEntityException({
                code: CATALOG_ERROR_CODES.BUNDLE_VERSION_VALID_FROM_REQUIRED,
                message:
                    'validFrom must be set when publishing (on the draft or the publish call). SPEC_V2 §4.2.',
            });
        }
        const validFrom = new Date(validFromInput);
        if (Number.isNaN(validFrom.getTime())) {
            throw new UnprocessableEntityException({
                code: CATALOG_ERROR_CODES.BUNDLE_VERSION_VALID_FROM_INVALID,
                message: `validFrom '${validFromInput}' is not a valid date`,
                params: { validFrom: validFromInput },
            });
        }
        if (previous?.validFrom) {
            const prevFrom = new Date(previous.validFrom);
            if (validFrom <= prevFrom) {
                throw new UnprocessableEntityException({
                    code: CATALOG_ERROR_CODES.BUNDLE_VERSION_VALID_FROM_NOT_AFTER_PREVIOUS,
                    message: `validFrom (${validFrom.toISOString()}) must be strictly after the validFrom of the previous version (${previous.validFrom}).`,
                    params: {
                        validFrom: validFrom.toISOString(),
                        previousValidFrom: previous.validFrom,
                    },
                });
            }
            // Gapless succession analogous to Plan: if the predecessor already
            // has an explicit validUntil, the successor must start seamlessly
            // on the following day (otherwise a gap or overlap).
            if (previous.validUntil) {
                const prevUntil = new Date(previous.validUntil);
                const dayMs = 24 * 60 * 60 * 1000;
                const requiredStart = new Date(prevUntil.getTime() + dayMs);
                if (validFrom.getTime() !== requiredStart.getTime()) {
                    throw new UnprocessableEntityException({
                        code: CATALOG_ERROR_CODES.BUNDLE_VERSION_VALID_FROM_NOT_GAPLESS,
                        message:
                            `The predecessor has validUntil=${previous.validUntil.slice(0, 10)} — the successor must ` +
                            `start seamlessly on the next day (${requiredStart.toISOString().slice(0, 10)}). ` +
                            `Received: ${validFrom.toISOString().slice(0, 10)}.`,
                        params: { received: validFrom.toISOString().slice(0, 10) },
                        requiredValidFrom: requiredStart.toISOString().slice(0, 10),
                        previousValidUntil: previous.validUntil,
                    });
                }
            }
        }

        // validUntil (optional, null = unbounded). Consistency check
        // against validFrom; auto-succession of the predecessor happens in the repo.
        const validUntilInput =
            publishMeta.validUntil !== undefined ? publishMeta.validUntil : draft.validUntil;
        const validUntil = validUntilInput ? new Date(validUntilInput) : null;
        if (validUntil && Number.isNaN(validUntil.getTime())) {
            throw new UnprocessableEntityException({
                code: CATALOG_ERROR_CODES.BUNDLE_VERSION_VALID_UNTIL_INVALID,
                message: `validUntil '${validUntilInput}' is not a valid date`,
                params: { validUntil: validUntilInput },
            });
        }
        if (validUntil && validUntil <= validFrom) {
            throw new UnprocessableEntityException({
                code: CATALOG_ERROR_CODES.BUNDLE_VERSION_VALID_UNTIL_BEFORE_FROM,
                message: `validUntil (${validUntil.toISOString()}) must be strictly after validFrom (${validFrom.toISOString()}).`,
                params: {
                    validUntil: validUntil.toISOString(),
                    validFrom: validFrom.toISOString(),
                },
            });
        }

        const diff = previous
            ? classifyBundleVersionDiff(
                  {
                      features: previous.features,
                      quotas: previous.quotas,
                      monthlyNet: previous.monthlyNet,
                      yearlyNet: previous.yearlyNet,
                  },
                  {
                      features: draft.features,
                      quotas: draft.quotas,
                      monthlyNet: draft.monthlyNet,
                      yearlyNet: draft.yearlyNet,
                  },
              )
            : { changes: [], nonRegressive: true };

        if (!diff.nonRegressive && !publishMeta.forceRegressive) {
            throw new UnprocessableEntityException({
                code: CATALOG_ERROR_CODES.BUNDLE_VERSION_REGRESSION,
                message:
                    'This bundle version is regressive (feature removed / quota lowered / price raised). ' +
                    'Publishing requires an explicit `forceRegressive: true` (UI confirmation dialog with MFA).',
                changes: diff.changes,
            });
        }

        const bundleVersion = await this.repo.publishDraft(versionId, {
            publishedByUserId: publishMeta.publishedByUserId,
            publishedChanges: diff.changes,
            nonRegressive: diff.nonRegressive,
            validFrom,
            validUntil,
        });
        return { bundleVersion, warnings };
    }

    // =========================================================================
    // Helper
    // =========================================================================

    private async runStrictCheck(
        draft: {
            features: string[];
            quotas: Record<string, number>;
            compatibility?: BundleCompatibility;
        },
        projectKey: string | null,
    ): Promise<StrictModeWarning[]> {
        const snapshot = resolveDiscoverySnapshot(this.snapshot, this.scanner);
        if (!snapshot) return [];
        const planIds = draft.compatibility?.planIds ?? [];
        let knownPlanKeys: Set<string> | null = null;
        if (planIds.length > 0 && this.planRepo && projectKey) {
            // Lazy: only list when the bundle actually sets plan-compat keys —
            // otherwise we save the repo call. `findByKey` individually would be
            // one round-trip per planKey; `list` is more pragmatic and fine for
            // SuperAdmin with few plans.
            const all = await this.planRepo.list({ projectKey });
            knownPlanKeys = new Set(all.map((p) => p.planKey));
        }
        // Approved gate (#20 Slice 5): projectKey == snapshot.app.key (convention).
        const approved = await loadApprovedCatalogKeys(this.catalogEntries, snapshot.app.key);
        return validateBundleDraft(draft, snapshot, knownPlanKeys, this.marketedOnly, approved);
    }

    private gateOrPass(warnings: StrictModeWarning[]): void {
        // Advisory warnings (#35) never gate — they only go into the UI as a banner.
        const blocking = blockingStrictModeWarnings(warnings);
        if (blocking.length === 0) return;
        const hasHardBlockingWarning = blocking.some((w) => w.code === 'BUNDLE_PLAN_KEY_UNKNOWN');
        if (this.mode === 'blocking' || hasHardBlockingWarning) {
            throw new UnprocessableEntityException({
                code: CATALOG_ERROR_CODES.STRICT_MODE_VIOLATIONS,
                message: 'The strict-mode check found drift against the discovery snapshot.',
                warnings,
            });
        }
        // warn-only: pass through, warnings are attached to the result for the caller.
    }

    private async assertBundleVersionWindowUpdate(
        existing: BundleVersionRow,
        data: UpdateBundleVersionDraftData,
    ): Promise<void> {
        if (data.validFrom === undefined && data.validUntil === undefined) return;

        const validFromInput = data.validFrom !== undefined ? data.validFrom : existing.validFrom;
        const validUntilInput =
            data.validUntil !== undefined ? data.validUntil : existing.validUntil;

        const validUntil = this.parseOptionalBundleDate(
            validUntilInput,
            'validUntil',
            'BUNDLE_VERSION_VALID_UNTIL_INVALID',
        );

        if (!validFromInput) {
            if (existing.publishedAt !== null) {
                throw new UnprocessableEntityException({
                    code: CATALOG_ERROR_CODES.BUNDLE_VERSION_VALID_FROM_REQUIRED,
                    message:
                        'Published bundle versions must keep a validFrom. ' +
                        'Set a new future date, or edit the draft before publishing.',
                });
            }
            return;
        }

        const validFrom = this.parseRequiredBundleDate(
            validFromInput,
            'validFrom',
            'BUNDLE_VERSION_VALID_FROM_INVALID',
        );

        if (existing.publishedAt !== null && validFrom.getTime() <= Date.now()) {
            throw new UnprocessableEntityException({
                code: CATALOG_ERROR_CODES.BUNDLE_VERSION_VALID_FROM_NOT_FUTURE,
                message:
                    `validFrom (${validFrom.toISOString()}) must, for a published-but-future ` +
                    'bundle version, still lie in the future.',
                params: { validFrom: validFrom.toISOString() },
            });
        }

        if (validUntil && validUntil <= validFrom) {
            throw new UnprocessableEntityException({
                code: CATALOG_ERROR_CODES.BUNDLE_VERSION_VALID_UNTIL_BEFORE_FROM,
                message: `validUntil (${validUntil.toISOString()}) must be strictly after validFrom (${validFrom.toISOString()}).`,
                params: {
                    validUntil: validUntil.toISOString(),
                    validFrom: validFrom.toISOString(),
                },
            });
        }

        const previous = await this.findPreviousBundleVersion(existing);
        if (!previous?.validFrom) return;

        const previousValidFrom = new Date(previous.validFrom);
        if (Number.isNaN(previousValidFrom.getTime())) return;

        if (validFrom <= previousValidFrom) {
            throw new UnprocessableEntityException({
                code: CATALOG_ERROR_CODES.BUNDLE_VERSION_VALID_FROM_NOT_AFTER_PREVIOUS,
                message: `validFrom (${validFrom.toISOString()}) must be strictly after the validFrom of the previous version (${previous.validFrom}).`,
                params: {
                    validFrom: validFrom.toISOString(),
                    previousValidFrom: previous.validFrom,
                },
            });
        }

        if (!previous.validUntil) return;
        const previousValidUntil = new Date(previous.validUntil);
        if (Number.isNaN(previousValidUntil.getTime())) return;

        const dayMs = 24 * 60 * 60 * 1000;
        const requiredStart = new Date(previousValidUntil.getTime() + dayMs);
        if (validFrom.getTime() !== requiredStart.getTime()) {
            throw new UnprocessableEntityException({
                code: CATALOG_ERROR_CODES.BUNDLE_VERSION_VALID_FROM_NOT_GAPLESS,
                message:
                    `The predecessor has validUntil=${previous.validUntil.slice(0, 10)} — the successor must ` +
                    `start seamlessly on the next day (${requiredStart.toISOString().slice(0, 10)}). ` +
                    `Received: ${validFrom.toISOString().slice(0, 10)}.`,
                params: { received: validFrom.toISOString().slice(0, 10) },
                requiredValidFrom: requiredStart.toISOString().slice(0, 10),
                previousValidUntil: previous.validUntil,
            });
        }
    }

    private async findPreviousBundleVersion(
        existing: BundleVersionRow,
    ): Promise<BundleVersionRow | null> {
        const versions = await this.repo.listVersions(existing.bundleId);
        return (
            versions
                .filter((v) => v.id !== existing.id && v.version < existing.version)
                .sort((a, b) => b.version - a.version)[0] ?? null
        );
    }

    private parseOptionalBundleDate(
        input: string | null | undefined,
        field: 'validFrom' | 'validUntil',
        code: string,
    ): Date | null {
        if (!input) return null;
        return this.parseRequiredBundleDate(input, field, code);
    }

    private parseRequiredBundleDate(
        input: string,
        field: 'validFrom' | 'validUntil',
        code: string,
    ): Date {
        const date = new Date(input);
        if (Number.isNaN(date.getTime())) {
            throw new UnprocessableEntityException({
                code,
                message: `${field} '${input}' is not a valid date`,
                params: { field, value: input },
            });
        }
        return date;
    }
}
