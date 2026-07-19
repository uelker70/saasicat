// PlanVersionsService — PlanVersion-Lifecycle (SPEC_V2 §11.1 M6 Pack 2a + 3a).
//
// Strukturell analog zu BundlesService' Version-Operationen:
// listVersions/getVersion/createDraft/updateDraft/publish, mit
// Vertragsschutz P3 (Diff-basierte Regressions-Gate) und seit Pack 3a
// auch Strict-Mode-Check (`validatePlanDraft` aus strict-mode-check.ts):
// Feature-Existenz + Quota-Existenz im DiscoverySnapshot. Mode (warn-only
// vs. blocking) kommt aus `CatalogServiceConfig.strictModeCheckMode`,
// gemeinsam mit den anderen Catalog-Services.

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
        // #25: blocking ohne Snapshot-Quelle nicht crashen — laut loggen + degradieren.
        if (this.mode === 'blocking' && !hasDiscoverySnapshotSource(this.snapshot, this.scanner)) {
            this.logger.error(
                'PlanVersionsService: strictModeCheckMode=blocking ohne DiscoverySnapshot-Quelle — ' +
                    'degradiere auf warn-only. DiscoveryModule wiren (#25).',
            );
            this.mode = 'warn-only';
        }
        // Hard-fail beim Boot, wenn das Repository die Lifecycle-Methoden
        // nicht implementiert. Apps ohne SuperAdmin-Plan-Editor sollten
        // PlanVersionsService gar nicht registrieren (CatalogModule.forRoot
        // Pack 2: explizites Opt-in via `planRepository` mit Lifecycle-Methods).
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
     * Verwirft eine Draft-Version. Erlaubt nur, wenn die Version noch nicht
     * published wurde — published Versions bleiben unveränderlich erhalten,
     * weil Bestand-Subscriptions sie referenzieren (Vertragsschutz P1).
     *
     * Wenn das Repository die Methode nicht implementiert, antwortet der
     * Endpoint mit 501 Not Implemented (Konsumenten ohne Editor-Stack
     * sollten `PlanVersionsService` ohnehin nicht registrieren).
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
     * @param planUuid UUID des Plan-Stamms (Plan.id) — wird vor dem Repo-Call
     *   zu planKey resolved (Lifecycle-Methoden arbeiten mit planKey, weil
     *   PlanVersion.planId im Schema ein String ist).
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
     * Reichert jede Version mit `isLatestInChain` (höchste Versions-Nummer
     * im Stamm) + `subscriptionCount` an, damit UI und Backend dieselbe
     * Editierbarkeits-Entscheidung treffen. `subscriptionCount` bleibt
     * `undefined`, wenn kein SubscriptionRepository registriert ist —
     * `isVersionEditable` interpretiert das fail-closed (= eingefroren).
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
                // Nur die latest-in-chain published Version kann via
                // pre-active editiert werden; für alle anderen sparen wir
                // den COUNT(*).
                const subscriptionCount =
                    counter && isLatestInChain && v.publishedAt !== null && v.supersededAt === null
                        ? await counter(v.id)
                        : undefined;
                return { ...v, isLatestInChain, subscriptionCount };
            }),
        );
    }

    /**
     * @param data.planId — vom Controller die Plan-UUID. Wird vor dem
     *   Repo-Aufruf zu planKey resolved.
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

        // baseVersionId default: latest live (oder null bei v1)
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

        // Editierbarkeits-Gate: Draft (klassisch) oder published-but-future
        // (latest-in-chain + keine Subscription + validFrom > now).
        // Wir reichern die Version frisch an, damit der Check dieselben
        // computed Felder sieht wie der List-Read in der UI.
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

        // ─── Preis-Gate (Schutz gegen versehentliches Publish von Seed-Platzhaltern) ───
        // Plan-Preise sind non-null Decimals; 0,00 ist der Seed-Entwurfs-Platzhalter
        // ("Preise vor dem Publish setzen"). Ein versehentlicher Batch-Publish mit 0,00
        // hat die Tarife schon einmal auf gratis gestellt. Kostenlose Sonderverträge
        // (z.B. ENTERPRISE) setzen `allowZeroPrice: true`.
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

        // ─── validFrom (Pflicht beim Publish, SPEC_V2 §4.2) ───
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
            // SPEC_V2 §4.2.1 Regel 3 (erweitert): lückenlose Sukzession, wenn
            // der Vorgänger bereits einen `validUntil` trägt. Dann muss der
            // Nachfolger nahtlos am Folgetag anschließen — sonst entsteht
            // entweder eine Lücke (keine gültige Version) oder eine
            // Überlappung (zwei live gleichzeitig).
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

        // validUntil (optional, null = unbegrenzt). Konsistenz-Check
        // gegen validFrom; Auto-Sukzession des Vorgängers passiert im Repo.
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

        // classifyPlanDiff erwartet flat fields (AutohausPro-Legacy: maxUsers,
        // maxVehicles, maxStorageGb). PlanVersionRow.quotas ist generisch;
        // wir mappen die drei Standard-Keys, andere Quota-Keys werden vom
        // Diff (noch) ignoriert — Pack 2c generalisiert classifyPlanDiff.
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
     * Terminiert eine **live** PlanVersion durch Setzen von `endsAt`.
     * Im Gegensatz zu Auto-Sukzession (validUntil) ist das ein expliziter
     * User-Eingriff: die Version wird nicht durch eine Nachfolge-Version
     * ersetzt, sondern läuft am gewählten Datum aus. Bestand-Subscriptions
     * (P1) bleiben gebunden — wirkt nur auf neue Buchungen.
     *
     * Idempotent — ein zweiter Aufruf mit anderem Datum überschreibt.
     *
     * Vorbedingungen:
     *   - Version muss live sein (`publishedAt != null && supersededAt == null`).
     *   - `endsAt` muss in der Zukunft liegen (`endsAt > now`).
     *
     * Wenn das Repository die Methode nicht implementiert, antwortet der
     * Endpoint mit 422 `PLAN_TERMINATE_NOT_IMPLEMENTED`.
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
    // Strict-Mode-Check Helpers (Pack 3a)
    // =========================================================================

    private async runStrictCheck(draft: {
        features: string[];
        quotas: Record<string, number>;
    }): Promise<StrictModeWarning[]> {
        const snapshot = resolveDiscoverySnapshot(this.snapshot, this.scanner);
        if (!snapshot) return [];
        // Approved-Gate (#20 Slice 5): projectKey == snapshot.app.key (Konvention).
        const approved = await loadApprovedCatalogKeys(this.catalogEntries, snapshot.app.key);
        return validatePlanDraft(draft, snapshot, this.marketedOnly, approved);
    }

    private gateOrPass(warnings: StrictModeWarning[]): void {
        // Advisory-Warnings (#35) gaten nie — sie gehen nur als Banner ins UI.
        if (blockingStrictModeWarnings(warnings).length === 0) return;
        if (this.mode === 'blocking') {
            throw new UnprocessableEntityException({
                code: 'STRICT_MODE_VIOLATIONS',
                message: 'Strict-Mode-Check hat Drift gegen den Discovery-Snapshot gefunden.',
                warnings,
            });
        }
        // warn-only: durchlassen, Warnings hängen am Result.
    }
}
