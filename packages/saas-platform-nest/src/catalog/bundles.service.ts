// BundlesService — CRUD für `bundles` + `bundle_versions`.
//
// Verbindet Repository (Persistenz) + Discovery-Snapshot (Code-Validierung)
// + Versions-Diff (Vertragsschutz P3-Klassifikation). Mutierende Operationen
// auf BundleVersion liefern `BundleVersionMutationResult` mit Warnings für
// das UI; harte Fehler (z. B. doppelter `bundleKey`, NotFound) werfen
// HttpException.
//
// Im warn-only-Modus (`STRICT_CATALOG_CHECK_MODE = 'warn-only'`, siehe
// SPEC_V2 §8.1) gehen Strict-Mode-Verstöße als `warnings`-Liste durch;
// im blocking-Modus wirft der Service stattdessen HTTP 422 mit derselben
// Warning-Liste als Body. Default: blocking (#12). Ausnahme: kaputte
// `compatibility.planIds` blocken immer, sobald ein PlanRepository fuer
// die Existenzpruefung registriert ist.

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
    type BundleCompatibility,
    type BundleRepository,
    type BundleRow,
    type BundleVersionMutationResult,
    type BundleVersionRow,
    type CreateBundleData,
    type CatalogEntryRepository,
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
 * Konfiguration für die mutierenden Operations.
 */
export interface CatalogServiceConfig {
    /** Aktiver Modus für den Strict-Mode-Check. Default `'blocking'` (#12). */
    strictModeCheckMode?: 'warn-only' | 'blocking';
    /**
     * Discovery→Catalog-Auto-Sync beim Boot (#12). Default `true` — läuft, wenn
     * ein `DiscoverySnapshot` bereitsteht. Auf `false` setzen, um den Boot-Sync
     * zu deaktivieren; der manuelle `POST /admin/catalog/discovery/sync` bleibt
     * davon unberührt.
     */
    autoSyncDiscoveryAtBoot?: boolean;
    /**
     * Feature-Keys, die der Katalog bewusst führen darf, OHNE dass sie im
     * Discovery-Snapshot (= im Code via @ImplementsCapability) existieren —
     * vermarktete Nicht-Code-Features wie Support-SLAs (z. B. PRIORITY_SUPPORT).
     * Der Strict-Mode-Check meldet sie NICHT als BUNDLE_/PLAN_FEATURE_UNKNOWN.
     * Sparsam einsetzen: das ist die einzige legitime Ausnahme von „Code ist
     * Source-of-Truth"; noch-nicht-gebaute Features gehören NICHT hierher,
     * sondern aus dem Katalog entfernt, bis sie implementiert sind.
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
        // #25: blocking braucht eine Snapshot-Quelle (injizierter Token ODER
        // DiscoveryScanner). Fehlt beides, NICHT crashen (das verursachte einen
        // Prod-Outage) — laut loggen + auf warn-only degradieren.
        if (this.mode === 'blocking' && !hasDiscoverySnapshotSource(this.snapshot, this.scanner)) {
            this.logger.error(
                'BundlesService: strictModeCheckMode=blocking ohne DiscoverySnapshot-Quelle — ' +
                    'degradiere auf warn-only. DiscoveryModule wiren, damit die Erzwingung greift (#25).',
            );
            this.mode = 'warn-only';
        }
    }

    // =========================================================================
    // Stamm-Operationen
    // =========================================================================

    listBundles(projectKey: string): Promise<BundleRow[]> {
        return this.repo.list({ projectKey, excludeDeleted: true });
    }

    async getBundle(
        bundleId: string,
    ): Promise<{ bundle: BundleRow; versions: BundleVersionRow[] }> {
        const bundle = await this.repo.findById(bundleId);
        if (!bundle) throw new NotFoundException(`Bundle '${bundleId}' nicht gefunden`);
        const versions = await this.annotateEditability(await this.repo.listVersions(bundleId));
        return { bundle, versions };
    }

    async createBundle(data: CreateBundleData): Promise<BundleRow> {
        const existing = await this.repo.findByKey(data.projectKey, data.bundleKey);
        if (existing) {
            throw new UnprocessableEntityException(
                `Bundle '${data.bundleKey}' existiert bereits in Projekt '${data.projectKey}'`,
            );
        }
        return this.repo.create(data);
    }

    async updateBundle(bundleId: string, data: UpdateBundleData): Promise<BundleRow> {
        const existing = await this.repo.findById(bundleId);
        if (!existing) throw new NotFoundException(`Bundle '${bundleId}' nicht gefunden`);
        return this.repo.update(bundleId, data);
    }

    async softDeleteBundle(bundleId: string): Promise<void> {
        const existing = await this.repo.findById(bundleId);
        if (!existing) throw new NotFoundException(`Bundle '${bundleId}' nicht gefunden`);
        if (existing.deletedAt !== null) return; // idempotent
        await this.repo.softDelete(bundleId);
    }

    /**
     * Verwirft eine Draft-BundleVersion (`publishedAt === null`) hart aus
     * der DB. Published Versions bleiben unveränderlich (Vertragsschutz
     * P1) — der Service wirft 422 mit Code `BUNDLE_VERSION_ALREADY_PUBLISHED`.
     */
    async discardBundleDraft(versionId: string): Promise<void> {
        const existing = await this.repo.findVersionById(versionId);
        if (!existing) {
            throw new NotFoundException(`BundleVersion '${versionId}' nicht gefunden`);
        }
        if (existing.publishedAt !== null) {
            throw new UnprocessableEntityException({
                code: 'BUNDLE_VERSION_ALREADY_PUBLISHED',
                message: `BundleVersion '${versionId}' ist bereits published und kann nicht verworfen werden.`,
            });
        }
        if (typeof this.repo.deleteDraft !== 'function') {
            throw new UnprocessableEntityException({
                code: 'BUNDLE_VERSION_DISCARD_NOT_IMPLEMENTED',
                message:
                    'Discard ist im aktuellen Repository nicht implementiert. ' +
                    'Implementiere BundleRepository.deleteDraft.',
            });
        }
        await this.repo.deleteDraft(versionId);
    }

    // =========================================================================
    // Version-Operationen
    // =========================================================================

    async listBundleVersions(bundleId: string): Promise<BundleVersionRow[]> {
        return this.annotateEditability(await this.repo.listVersions(bundleId));
    }

    async getBundleVersion(versionId: string): Promise<BundleVersionRow> {
        const version = await this.repo.findVersionById(versionId);
        if (!version) {
            throw new NotFoundException(`BundleVersion '${versionId}' nicht gefunden`);
        }
        const [annotated] = await this.annotateEditability([version]);
        return annotated;
    }

    /**
     * Reichert jede BundleVersion mit `isLatestInChain` (höchste
     * Versions-Nummer im Stamm) + `subscriptionCount` an, damit UI und
     * Backend dieselbe Editierbarkeits-Entscheidung treffen.
     * `subscriptionCount` bleibt `undefined`, wenn kein
     * SubscriptionRepository registriert ist oder die Methode nicht
     * implementiert wurde — `isVersionEditable` interpretiert das
     * fail-closed (= eingefroren).
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
     * Legt eine neue Draft-BundleVersion an. Wirft, wenn bereits eine Draft
     * für denselben Bundle existiert (Repository-Constraint).
     *
     * Strict-Mode-Check läuft auf der Eingabe; in `warn-only` werden
     * Warnings zurückgegeben, in `blocking` wirft der Service HTTP 422.
     */
    async createBundleDraft(
        data: CreateBundleVersionDraftData,
    ): Promise<BundleVersionMutationResult> {
        const bundle = await this.repo.findById(data.bundleId);
        if (!bundle) {
            throw new NotFoundException(`Bundle '${data.bundleId}' nicht gefunden`);
        }

        const existingDraft = await this.repo.findCurrentDraft(data.bundleId);
        if (existingDraft) {
            throw new UnprocessableEntityException(
                `Bundle '${bundle.bundleKey}' hat bereits eine Draft-Version v${existingDraft.version}; bitte erst publishen oder verwerfen`,
            );
        }

        // baseVersionId default: latest live (oder null bei v1)
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
     * Aktualisiert eine Draft-Version oder — als bewusste Aufweichung von
     * Vertragsschutz P1 — eine published-but-future BundleVersion, die
     * latest-in-chain ist und noch keine Subscription bindet. Sobald
     * `validFrom` erreicht ist oder eine Buchung sie referenziert, friert
     * die Version wieder ein. Die konkrete Entscheidung trifft der
     * `isVersionEditable`-Helper, der von der UI gespiegelt wird.
     */
    async updateBundleDraft(
        versionId: string,
        data: UpdateBundleVersionDraftData,
    ): Promise<BundleVersionMutationResult> {
        const existing = await this.repo.findVersionById(versionId);
        if (!existing) {
            throw new NotFoundException(`BundleVersion '${versionId}' nicht gefunden`);
        }

        const [annotated] = await this.annotateEditability([existing]);
        const { editable } = isVersionEditable(annotated);
        if (!editable) {
            throw new UnprocessableEntityException({
                code: 'BUNDLE_VERSION_NOT_EDITABLE',
                message:
                    `BundleVersion '${versionId}' ist nicht editierbar. ` +
                    'Editierbar sind nur Drafts und published Versionen, die latest-in-chain ' +
                    'sind, noch keine Subscription binden und deren validFrom in der Zukunft liegt.',
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
     * Veröffentlicht eine Draft-Version atomar. Schritte:
     * 1. Strict-Check auf der Draft-Definition (warn-only oder blocking)
     * 2. validFrom-Pflicht + Reihenfolge gegen Vorgänger prüfen
     *    (SPEC_V2 §4.2 + §11.1 M6 Pack 2c, analog PlanVersion)
     * 3. Diff zur Vorgänger-Version (latest live) berechnen →
     *    `publishedChanges` + `nonRegressive` per `classifyBundleVersionDiff`
     * 4. Repository.publishDraft mit Diff-Resultat + Gültigkeitsdaten
     *    aufrufen (Transaktion; Auto-Sukzession setzt vorherige
     *    validUntil)
     */
    async publishBundleVersion(
        versionId: string,
        publishMeta: PublishBundleVersionData,
    ): Promise<BundleVersionMutationResult> {
        const draft = await this.repo.findVersionById(versionId);
        if (!draft) {
            throw new NotFoundException(`BundleVersion '${versionId}' nicht gefunden`);
        }
        if (draft.publishedAt !== null) {
            throw new UnprocessableEntityException(
                `BundleVersion '${versionId}' ist bereits published`,
            );
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

        // ─── Preis-Gate (Schutz gegen versehentliches Publish von Seed-Platzhaltern) ───
        // Bundle-Preise dürfen null sein (Override-Resolution) — nur ein EXPLIZITER
        // 0,00-Wert ist verdächtig (Seed-Entwurf). Sonderfälle: allowZeroPrice: true.
        if (!publishMeta.allowZeroPrice) {
            const explicitZero = (v: string | null | undefined): boolean =>
                v !== null && v !== undefined && Number.parseFloat(String(v)) <= 0;
            if (explicitZero(draft.monthlyNet) || explicitZero(draft.yearlyNet)) {
                throw new UnprocessableEntityException({
                    code: 'BUNDLE_VERSION_ZERO_PRICE',
                    message:
                        'BundleVersion kann nicht mit explizitem Preis 0,00 published werden (Schutz ' +
                        'gegen Seed-Platzhalter). Preisfreie Bundles: null lassen oder allowZeroPrice setzen.',
                    monthlyNet: draft.monthlyNet,
                    yearlyNet: draft.yearlyNet,
                });
            }
        }

        const previous = await this.repo.findLatestLive(draft.bundleId);

        // ─── validFrom (Pflicht beim Publish, SPEC_V2 §4.2) ───
        const validFromInput = publishMeta.validFrom ?? draft.validFrom;
        if (!validFromInput) {
            throw new UnprocessableEntityException({
                code: 'BUNDLE_VERSION_VALID_FROM_REQUIRED',
                message:
                    'Beim Publish muss validFrom gesetzt sein (auf Draft oder Publish-Aufruf). SPEC_V2 §4.2.',
            });
        }
        const validFrom = new Date(validFromInput);
        if (Number.isNaN(validFrom.getTime())) {
            throw new UnprocessableEntityException({
                code: 'BUNDLE_VERSION_VALID_FROM_INVALID',
                message: `validFrom '${validFromInput}' ist kein gültiges Datum`,
            });
        }
        if (previous?.validFrom) {
            const prevFrom = new Date(previous.validFrom);
            if (validFrom <= prevFrom) {
                throw new UnprocessableEntityException({
                    code: 'BUNDLE_VERSION_VALID_FROM_NOT_AFTER_PREVIOUS',
                    message: `validFrom (${validFrom.toISOString()}) muss strikt nach validFrom der Vorgänger-Version (${previous.validFrom}) liegen.`,
                });
            }
            // Gapless-Sukzession analog Plan: wenn der Vorgänger bereits
            // ein explizites validUntil hat, muss der Nachfolger nahtlos
            // am Folgetag starten (sonst Lücke oder Überlappung).
            if (previous.validUntil) {
                const prevUntil = new Date(previous.validUntil);
                const dayMs = 24 * 60 * 60 * 1000;
                const requiredStart = new Date(prevUntil.getTime() + dayMs);
                if (validFrom.getTime() !== requiredStart.getTime()) {
                    throw new UnprocessableEntityException({
                        code: 'BUNDLE_VERSION_VALID_FROM_NOT_GAPLESS',
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
                code: 'BUNDLE_VERSION_VALID_UNTIL_INVALID',
                message: `validUntil '${validUntilInput}' ist kein gültiges Datum`,
            });
        }
        if (validUntil && validUntil <= validFrom) {
            throw new UnprocessableEntityException({
                code: 'BUNDLE_VERSION_VALID_UNTIL_BEFORE_FROM',
                message: `validUntil (${validUntil.toISOString()}) muss strikt nach validFrom (${validFrom.toISOString()}) liegen.`,
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
                code: 'BUNDLE_VERSION_REGRESSION',
                message:
                    'Diese BundleVersion ist regressiv (Feature entfernt / Quota gesenkt / Preis erhöht). ' +
                    'Publishen erfordert explizites `forceRegressive: true` (UI-Bestätigungsmodal mit MFA).',
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
            // Lazy: nur listen, wenn der Bundle wirklich Plan-Kompat-Keys
            // setzt — sonst sparen wir den Repo-Call. `findByKey` einzeln
            // wäre per planId ein Round-Trip pro planKey; `list` ist
            // pragmatischer und für SuperAdmin mit wenigen Plänen OK.
            const all = await this.planRepo.list({ projectKey });
            knownPlanKeys = new Set(all.map((p) => p.planKey));
        }
        // Approved-Gate (#20 Slice 5): projectKey == snapshot.app.key (Konvention).
        const approved = await loadApprovedCatalogKeys(this.catalogEntries, snapshot.app.key);
        return validateBundleDraft(draft, snapshot, knownPlanKeys, this.marketedOnly, approved);
    }

    private gateOrPass(warnings: StrictModeWarning[]): void {
        // Advisory-Warnings (#35) gaten nie — sie gehen nur als Banner ins UI.
        const blocking = blockingStrictModeWarnings(warnings);
        if (blocking.length === 0) return;
        const hasHardBlockingWarning = blocking.some((w) => w.code === 'BUNDLE_PLAN_KEY_UNKNOWN');
        if (this.mode === 'blocking' || hasHardBlockingWarning) {
            throw new UnprocessableEntityException({
                code: 'STRICT_MODE_VIOLATIONS',
                message: 'Strict-Mode-Check hat Drift gegen den Discovery-Snapshot gefunden.',
                warnings,
            });
        }
        // warn-only: durchlassen, Warnings werden im Result an den Caller gehängt.
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
                    code: 'BUNDLE_VERSION_VALID_FROM_REQUIRED',
                    message:
                        'Published BundleVersionen müssen ein validFrom behalten. ' +
                        'Setze ein neues zukünftiges Datum oder bearbeite die Draft vor dem Publish.',
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
                code: 'BUNDLE_VERSION_VALID_FROM_NOT_FUTURE',
                message:
                    `validFrom (${validFrom.toISOString()}) muss für eine published-but-future ` +
                    'BundleVersion weiterhin in der Zukunft liegen.',
            });
        }

        if (validUntil && validUntil <= validFrom) {
            throw new UnprocessableEntityException({
                code: 'BUNDLE_VERSION_VALID_UNTIL_BEFORE_FROM',
                message: `validUntil (${validUntil.toISOString()}) muss strikt nach validFrom (${validFrom.toISOString()}) liegen.`,
            });
        }

        const previous = await this.findPreviousBundleVersion(existing);
        if (!previous?.validFrom) return;

        const previousValidFrom = new Date(previous.validFrom);
        if (Number.isNaN(previousValidFrom.getTime())) return;

        if (validFrom <= previousValidFrom) {
            throw new UnprocessableEntityException({
                code: 'BUNDLE_VERSION_VALID_FROM_NOT_AFTER_PREVIOUS',
                message: `validFrom (${validFrom.toISOString()}) muss strikt nach validFrom der Vorgänger-Version (${previous.validFrom}) liegen.`,
            });
        }

        if (!previous.validUntil) return;
        const previousValidUntil = new Date(previous.validUntil);
        if (Number.isNaN(previousValidUntil.getTime())) return;

        const dayMs = 24 * 60 * 60 * 1000;
        const requiredStart = new Date(previousValidUntil.getTime() + dayMs);
        if (validFrom.getTime() !== requiredStart.getTime()) {
            throw new UnprocessableEntityException({
                code: 'BUNDLE_VERSION_VALID_FROM_NOT_GAPLESS',
                message:
                    `Vorgänger hat validUntil=${previous.validUntil.slice(0, 10)} — der Nachfolger muss ` +
                    `nahtlos am Folgetag (${requiredStart.toISOString().slice(0, 10)}) starten. ` +
                    `Geliefert: ${validFrom.toISOString().slice(0, 10)}.`,
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
                message: `${field} '${input}' ist kein gültiges Datum`,
            });
        }
        return date;
    }
}
