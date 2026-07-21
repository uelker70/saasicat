// PlanVersionsService — PlanVersion lifecycle (SPEC_V2 §11.1 M6 Pack 2a + 3a).
//
// Structurally analogous to BundlesService' version operations:
// listVersions/getVersion/createDraft/updateDraft/publish, with
// contract protection P3 (diff-based regression gate) and, since Pack 3a,
// also a strict mode check (`validatePlanDraft` from strict-mode-check.ts):
// feature existence + quota existence in the DiscoverySnapshot. Mode (warn-only
// vs. blocking) comes from `CatalogServiceConfig.strictModeCheckMode`,
// shared with the other catalog services.

import {
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
    UnprocessableEntityException,
} from '@nestjs/common';
import {
    isVersionEditable,
    type CatalogEntryRepository,
    type CreatePlanVersionDraftData,
    type DiscoverySnapshot,
    type PlanRepository,
    type PlanVersionMutationResult,
    type PlanVersionRow,
    type PublishPlanVersionData,
    type StrictModeWarning,
    type SubscriptionRepository,
    type UpdatePlanVersionDraftData,
} from '@saasicat/types';

import { classifyPlanDiff } from '../billing/version-diff.js';
import { DISCOVERY_SNAPSHOT_TOKEN } from '../discovery/tokens.js';
import { DiscoveryScanner } from '../discovery/discovery.scanner.js';
import {
    hasDiscoverySnapshotSource,
    resolveDiscoverySnapshot,
} from '../core/discovery-snapshot-source.js';
import { SUBSCRIPTION_REPOSITORY_TOKEN } from '../entitlement/tokens.js';
import {
    CATALOG_ENTRY_REPOSITORY_TOKEN,
    CATALOG_SERVICE_CONFIG_TOKEN,
    PLAN_REPOSITORY_TOKEN,
} from './tokens.js';
import type { CatalogServiceConfig } from './bundles.service.js';
import { loadApprovedCatalogKeys } from './approved-keys.js';
import { blockingStrictModeWarnings, validatePlanDraft } from './strict-mode-check.js';

@Injectable()
export class PlanVersionsService {
    private readonly logger = new Logger(PlanVersionsService.name);
    private mode: 'warn-only' | 'blocking';
    private readonly marketedOnly: ReadonlySet<string>;

    constructor(
        @Inject(PLAN_REPOSITORY_TOKEN)
        private readonly repo: PlanRepository,
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
        @Inject(DiscoveryScanner)
        private readonly scanner: DiscoveryScanner | null = null,
        @Optional()
        @Inject(CATALOG_ENTRY_REPOSITORY_TOKEN)
        private readonly catalogEntries: CatalogEntryRepository | null = null,
    ) {
        this.mode = config.strictModeCheckMode ?? 'blocking';
        this.marketedOnly = new Set(config.marketedOnlyFeatures ?? []);
        // #25: don't crash when blocking without a snapshot source — log loudly + degrade.
        if (this.mode === 'blocking' && !hasDiscoverySnapshotSource(this.snapshot, this.scanner)) {
            this.logger.error(
                'PlanVersionsService: strictModeCheckMode=blocking ohne DiscoverySnapshot-Quelle — ' +
                    'degradiere auf warn-only. DiscoveryModule wiren (#25).',
            );
            this.mode = 'warn-only';
        }
        // Hard-fail at boot if the repository does not implement the lifecycle
        // methods. Apps without the SuperAdmin plan editor should not register
        // PlanVersionsService at all (CatalogModule.forRoot
        // Pack 2: explicit opt-in via `planRepository` with lifecycle methods).
        const required: Array<keyof PlanRepository> = [
            'listVersions',
            'findVersionById',
            'findCurrentDraft',
            'findLatestLivePlanVersion',
            'createPlanVersionDraft',
            'updatePlanVersionDraft',
            'publishPlanVersionDraft',
        ];
        for (const key of required) {
            if (typeof this.repo[key] !== 'function') {
                throw new Error(
                    `PlanVersionsService: PlanRepository.${String(key)} fehlt — ` +
                        'das Repository implementiert die Lifecycle-Methoden nicht.',
                );
            }
        }
    }

    /**
     * Discards a draft version. Allowed only while the version has not yet
     * been published — published versions are preserved immutably,
     * because existing subscriptions reference them (contract protection P1).
     *
     * If the repository does not implement the method, the endpoint
     * responds with 501 Not Implemented (consumers without the editor stack
     * should not register `PlanVersionsService` anyway).
     */
    async discardPlanDraft(versionId: string): Promise<void> {
        const existing = await this.repo.findVersionById!(versionId);
        if (!existing) {
            throw new NotFoundException(`PlanVersion '${versionId}' nicht gefunden`);
        }
        if (existing.publishedAt !== null) {
            throw new UnprocessableEntityException({
                code: 'PLAN_VERSION_ALREADY_PUBLISHED',
                message: `PlanVersion '${versionId}' ist bereits published und kann nicht verworfen werden.`,
            });
        }
        if (typeof this.repo.deletePlanVersionDraft !== 'function') {
            throw new UnprocessableEntityException({
                code: 'PLAN_VERSION_DISCARD_NOT_IMPLEMENTED',
                message:
                    'Discard ist im aktuellen Repository nicht implementiert. ' +
                    'Implementiere PlanRepository.deletePlanVersionDraft.',
            });
        }
        await this.repo.deletePlanVersionDraft(versionId);
    }

    /**
     * @param planUuid UUID of the plan root (Plan.id) — resolved to planKey
     *   before the repo call (lifecycle methods work with planKey because
     *   PlanVersion.planId is a string in the schema).
     */
    async listPlanVersions(planUuid: string): Promise<PlanVersionRow[]> {
        const plan = await this.repo.findById(planUuid);
        if (!plan) {
            throw new NotFoundException(`Plan '${planUuid}' nicht gefunden`);
        }
        const versions = await this.repo.listVersions!(plan.planKey);
        return this.annotateEditability(versions);
    }

    async getPlanVersion(versionId: string): Promise<PlanVersionRow> {
        const version = await this.repo.findVersionById!(versionId);
        if (!version) {
            throw new NotFoundException(`PlanVersion '${versionId}' nicht gefunden`);
        }
        const [annotated] = await this.annotateEditability([version]);
        return annotated;
    }

    /**
     * Annotates each version with `isLatestInChain` (highest version number
     * in the root) + `subscriptionCount` so that UI and backend make the same
     * editability decision. `subscriptionCount` stays
     * `undefined` when no SubscriptionRepository is registered —
     * `isVersionEditable` interprets that fail-closed (= frozen).
     */
    private async annotateEditability(versions: PlanVersionRow[]): Promise<PlanVersionRow[]> {
        if (versions.length === 0) return versions;
        let maxVersion = -Infinity;
        for (const v of versions) {
            if (v.version > maxVersion) maxVersion = v.version;
        }
        const counter = this.subscriptions?.countByPlanVersionId?.bind(this.subscriptions);
        return Promise.all(
            versions.map(async (v) => {
                const isLatestInChain = v.version === maxVersion;
                // Only the latest-in-chain published version can be edited
                // via pre-active; for all others we save the
                // COUNT(*).
                const subscriptionCount =
                    counter && isLatestInChain && v.publishedAt !== null && v.supersededAt === null
                        ? await counter(v.id)
                        : undefined;
                return { ...v, isLatestInChain, subscriptionCount };
            }),
        );
    }

    /**
     * @param data.planId — the plan UUID from the controller. Resolved to
     *   planKey before the repo call.
     */
    async createPlanDraft(data: CreatePlanVersionDraftData): Promise<PlanVersionMutationResult> {
        const plan = await this.repo.findById(data.planId);
        if (!plan) {
            throw new NotFoundException(`Plan '${data.planId}' nicht gefunden`);
        }
        const planKey = plan.planKey;

        const existingDraft = await this.repo.findCurrentDraft!(planKey);
        if (existingDraft) {
            throw new UnprocessableEntityException(
                `Plan '${planKey}' hat bereits eine Draft-Version v${existingDraft.version}; bitte erst publishen oder verwerfen`,
            );
        }

        // baseVersionId default: latest live (or null for v1)
        let baseVersionId = data.baseVersionId;
        if (baseVersionId === undefined) {
            const latestLive = await this.repo.findLatestLivePlanVersion!(planKey);
            baseVersionId = latestLive?.id ?? null;
        }

        const warnings = await this.runStrictCheck({
            features: data.features,
            quotas: data.quotas ?? {},
        });
        this.gateOrPass(warnings);

        const planVersion = await this.repo.createPlanVersionDraft!({
            ...data,
            planId: planKey,
            baseVersionId,
        });
        return { planVersion, warnings };
    }

    async updatePlanDraft(
        versionId: string,
        data: UpdatePlanVersionDraftData,
    ): Promise<PlanVersionMutationResult> {
        const existing = await this.repo.findVersionById!(versionId);
        if (!existing) {
            throw new NotFoundException(`PlanVersion '${versionId}' nicht gefunden`);
        }

        // Editability gate: draft (classic) or published-but-future
        // (latest-in-chain + no subscription + validFrom > now).
        // We annotate the version freshly so the check sees the same
        // computed fields as the list read in the UI.
        const [annotated] = await this.annotateEditability([existing]);
        const { editable } = isVersionEditable(annotated);
        if (!editable) {
            throw new UnprocessableEntityException({
                code: 'PLAN_VERSION_NOT_EDITABLE',
                message:
                    `PlanVersion '${versionId}' ist nicht editierbar. ` +
                    'Editierbar sind nur Drafts und published Versionen, die latest-in-chain ' +
                    'sind, noch keine Subscription binden und deren validFrom in der Zukunft liegt.',
            });
        }

        const merged = {
            features: data.features ?? existing.features,
            quotas: data.quotas ?? existing.quotas ?? {},
        };
        const warnings = await this.runStrictCheck(merged);
        this.gateOrPass(warnings);

        const planVersion = await this.repo.updatePlanVersionDraft!(versionId, data);
        return { planVersion, warnings };
    }

    async publishPlanVersion(
        versionId: string,
        publishMeta: PublishPlanVersionData,
    ): Promise<PlanVersionMutationResult> {
        const draft = await this.repo.findVersionById!(versionId);
        if (!draft) {
            throw new NotFoundException(`PlanVersion '${versionId}' nicht gefunden`);
        }
        if (draft.publishedAt !== null) {
            throw new UnprocessableEntityException(
                `PlanVersion '${versionId}' ist bereits published`,
            );
        }

        const warnings = await this.runStrictCheck({
            features: draft.features,
            quotas: draft.quotas ?? {},
        });
        this.gateOrPass(warnings);

        // ─── Price gate (protection against accidental publish of seed placeholders) ───
        // Plan prices are non-null decimals; 0.00 is the seed draft placeholder
        // ("set prices before publishing"). An accidental batch publish with 0.00
        // once set the tariffs to free. Deliberately free special contracts
        // (e.g. ENTERPRISE) set `allowZeroPrice: true`.
        if (!publishMeta.allowZeroPrice) {
            const monthly = Number.parseFloat(String(draft.monthlyNet ?? '0'));
            const yearly = Number.parseFloat(String(draft.yearlyNet ?? '0'));
            if (monthly <= 0 || yearly <= 0) {
                throw new UnprocessableEntityException({
                    code: 'PLAN_VERSION_ZERO_PRICE',
                    message:
                        'PlanVersion kann nicht mit Preis 0,00 published werden (Schutz gegen ' +
                        'Seed-Platzhalter). Für bewusst kostenlose Sonderverträge: allowZeroPrice setzen.',
                    monthlyNet: String(draft.monthlyNet),
                    yearlyNet: String(draft.yearlyNet),
                });
            }
        }

        const previous = await this.repo.findLatestLivePlanVersion!(draft.planId);

        // ─── validFrom (required at publish, SPEC_V2 §4.2) ───
        const validFromInput = publishMeta.validFrom ?? draft.validFrom;
        if (!validFromInput) {
            throw new UnprocessableEntityException({
                code: 'PLAN_VERSION_VALID_FROM_REQUIRED',
                message:
                    'Beim Publish muss validFrom gesetzt sein (auf Draft oder Publish-Aufruf). SPEC_V2 §4.2.',
            });
        }
        const validFrom = new Date(validFromInput);
        if (Number.isNaN(validFrom.getTime())) {
            throw new UnprocessableEntityException({
                code: 'PLAN_VERSION_VALID_FROM_INVALID',
                message: `validFrom '${validFromInput}' ist kein gültiges Datum`,
            });
        }
        if (previous?.validFrom) {
            const prevFrom = new Date(previous.validFrom);
            if (validFrom <= prevFrom) {
                throw new UnprocessableEntityException({
                    code: 'PLAN_VERSION_VALID_FROM_NOT_AFTER_PREVIOUS',
                    message: `validFrom (${validFrom.toISOString()}) muss strikt nach validFrom der Vorgänger-Version (${previous.validFrom}) liegen.`,
                });
            }
            // SPEC_V2 §4.2.1 rule 3 (extended): gapless succession when
            // the predecessor already carries a `validUntil`. Then the
            // successor must connect seamlessly on the following day — otherwise
            // there is either a gap (no valid version) or an
            // overlap (two live at the same time).
            if (previous.validUntil) {
                const prevUntil = new Date(previous.validUntil);
                const dayMs = 24 * 60 * 60 * 1000;
                const requiredStart = new Date(prevUntil.getTime() + dayMs);
                if (validFrom.getTime() !== requiredStart.getTime()) {
                    throw new UnprocessableEntityException({
                        code: 'PLAN_VERSION_VALID_FROM_NOT_GAPLESS',
                        message:
                            `Vorgänger hat validUntil=${previous.validUntil.slice(0, 10)} — der Nachfolger muss ` +
                            `nahtlos am Folgetag (${requiredStart.toISOString().slice(0, 10)}) starten. ` +
                            `Geliefert: ${validFrom.toISOString().slice(0, 10)}.`,
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
                code: 'PLAN_VERSION_VALID_UNTIL_INVALID',
                message: `validUntil '${validUntilInput}' ist kein gültiges Datum`,
            });
        }
        if (validUntil && validUntil <= validFrom) {
            throw new UnprocessableEntityException({
                code: 'PLAN_VERSION_VALID_UNTIL_BEFORE_FROM',
                message: `validUntil (${validUntil.toISOString()}) muss strikt nach validFrom (${validFrom.toISOString()}) liegen.`,
            });
        }

        // classifyPlanDiff expects flat fields (legacy form: maxUsers,
        // maxVehicles, maxStorageGb). PlanVersionRow.quotas is generic;
        // we map the three standard keys, other quota keys are (still)
        // ignored by the diff — Pack 2c generalizes classifyPlanDiff.
        const fieldsFor = (v: PlanVersionRow) => ({
            features: v.features,
            maxUsers: v.quotas?.['users'] ?? 0,
            maxVehicles: v.quotas?.['vehicles'] ?? 0,
            maxStorageGb: v.quotas?.['storageGb'] ?? 0,
            monthlyNet: v.monthlyNet,
            yearlyNet: v.yearlyNet,
        });
        const diff = previous
            ? classifyPlanDiff(fieldsFor(previous), fieldsFor(draft))
            : { changes: [], nonRegressive: true };

        if (!diff.nonRegressive && !publishMeta.forceRegressive) {
            throw new UnprocessableEntityException({
                code: 'PLAN_VERSION_REGRESSION',
                message:
                    'Diese PlanVersion ist regressiv (Feature entfernt / Quota gesenkt / Preis erhöht). ' +
                    'Publishen erfordert explizites `forceRegressive: true` (UI-Bestätigungsmodal mit MFA).',
                changes: diff.changes,
            });
        }

        const planVersion = await this.repo.publishPlanVersionDraft!(versionId, {
            publishedByUserId: publishMeta.publishedByUserId,
            publishedChanges: diff.changes,
            nonRegressive: diff.nonRegressive,
            validFrom,
            validUntil,
        });
        return { planVersion, warnings };
    }

    /**
     * Terminates a **live** PlanVersion by setting `endsAt`.
     * Unlike auto-succession (validUntil), this is an explicit
     * user action: the version is not replaced by a successor version
     * but expires on the chosen date. Existing subscriptions
     * (P1) stay bound — this only affects new bookings.
     *
     * Idempotent — a second call with a different date overwrites.
     *
     * Preconditions:
     *   - Version must be live (`publishedAt != null && supersededAt == null`).
     *   - `endsAt` must lie in the future (`endsAt > now`).
     *
     * If the repository does not implement the method, the endpoint
     * responds with 422 `PLAN_TERMINATE_NOT_IMPLEMENTED`.
     */
    async terminatePlanVersion(versionId: string, endsAt: Date): Promise<PlanVersionRow> {
        const existing = await this.repo.findVersionById!(versionId);
        if (!existing) {
            throw new NotFoundException(`PlanVersion '${versionId}' nicht gefunden`);
        }
        if (existing.publishedAt === null) {
            throw new UnprocessableEntityException({
                code: 'PLAN_VERSION_NOT_LIVE',
                message: `PlanVersion '${versionId}' ist nicht published und kann nicht terminiert werden.`,
            });
        }
        if (existing.supersededAt !== null) {
            throw new UnprocessableEntityException({
                code: 'PLAN_VERSION_NOT_LIVE',
                message: `PlanVersion '${versionId}' wurde bereits von einer Nachfolge-Version abgelöst (supersededAt) und kann nicht terminiert werden.`,
            });
        }
        if (Number.isNaN(endsAt.getTime())) {
            throw new UnprocessableEntityException({
                code: 'PLAN_TERMINATE_INVALID_DATE',
                message: 'endsAt ist kein gültiges Datum.',
            });
        }
        if (endsAt.getTime() <= Date.now()) {
            throw new UnprocessableEntityException({
                code: 'PLAN_TERMINATE_DATE_NOT_FUTURE',
                message: `endsAt (${endsAt.toISOString()}) muss strikt in der Zukunft liegen.`,
            });
        }
        if (typeof this.repo.terminate !== 'function') {
            throw new UnprocessableEntityException({
                code: 'PLAN_TERMINATE_NOT_IMPLEMENTED',
                message:
                    'Terminate ist im aktuellen Repository nicht implementiert. ' +
                    'Implementiere PlanRepository.terminate.',
            });
        }
        return this.repo.terminate(versionId, endsAt);
    }

    // =========================================================================
    // Strict mode check helpers (Pack 3a)
    // =========================================================================

    private async runStrictCheck(draft: {
        features: string[];
        quotas: Record<string, number>;
    }): Promise<StrictModeWarning[]> {
        const snapshot = resolveDiscoverySnapshot(this.snapshot, this.scanner);
        if (!snapshot) return [];
        // Approved gate (#20 Slice 5): projectKey == snapshot.app.key (convention).
        const approved = await loadApprovedCatalogKeys(this.catalogEntries, snapshot.app.key);
        return validatePlanDraft(draft, snapshot, this.marketedOnly, approved);
    }

    private gateOrPass(warnings: StrictModeWarning[]): void {
        // Advisory warnings (#35) never gate — they only go into the UI as a banner.
        if (blockingStrictModeWarnings(warnings).length === 0) return;
        if (this.mode === 'blocking') {
            throw new UnprocessableEntityException({
                code: 'STRICT_MODE_VIOLATIONS',
                message: 'Strict-Mode-Check hat Drift gegen den Discovery-Snapshot gefunden.',
                warnings,
            });
        }
        // warn-only: let through, warnings are attached to the result.
    }
}
