// SubscriptionBundlePreviewService (#37) — Vorschau für mid-cycle
// Bundle-Add/-Cancel im Tenant-Self-Service, analog PlanChangePreviewService.
//
// Add-Preview liefert:
//   - Proration: anteiliger Betrag bis Periodenende (geteilter Helper
//     `computeProration`, currentPriceNet = 0 — es kommt nur etwas hinzu)
//   - Folgeperioden-Preis im aktuellen Abrechnungszyklus
//   - Redundanz-Hinweis (sakarel AK-13 Doppelbezahlungs-Falle): Features,
//     die bereits im Plan oder einem anderen aktiven Bundle enthalten sind
//   - Dependency-Check gegen `requires` (#35): fehlende requires-Features
//     werden ausgewiesen und blocken
//   - Self-Service-Policy: Vertriebs-only-Bundles (SelfServiceBlockedBundles)
//
// Cancel-Preview liefert das Wirksamkeits-Datum
// (`max(currentPeriodEnd, minimumTermEndsAt)`, geteilt mit der Mutation via
// `resolveBundleCancelEffectiveAt`) und die Ersparnis ab Folgeperiode.
// Bewusst keine anteilige Gutschrift: Kündigungen wirken frühestens zum
// Periodenende, der Bestand bleibt bis dahin aktiv.
//
// SubscriptionContract-Fortschreibung (Entscheidung, #37): Mid-cycle-Add/
// Cancel schreibt in der Plattform KEINEN neuen Contract-Stand fest. Die
// Entitlement-Aggregation liest die `subscription_bundles`-Junction zur
// Laufzeit. Konsumenten, die den V3-Contract-Freeze nutzen
// (`ContractFreezePort`), müssen nach erfolgreichem Add/Cancel re-freezen
// (`freezeOnPlanChange` mit unverändertem Plan = Amendment als neuer
// Contract-Stand) — sonst läse der EntitlementService den alten
// eingefrorenen Snapshot zurück. Bewusst Konsumenten-Hook statt
// Plattform-Automatik: der Freeze braucht App-Kontext (Preise, VAT,
// Bundle-Quellen via ContractFreezeSourcePort).

import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type {
    BillingCycle,
    BundleRepository,
    BundleVersionRow,
    CatalogEntryRepository,
    PlanRepository,
    SubscriptionBundleRepository,
} from '@saasicat/types';
import { buildFeatureRequiresIndex, collectUnsatisfiedRequires } from '@saasicat/types';

import {
    CATALOG_ENTRY_REPOSITORY_TOKEN,
    BUNDLE_REPOSITORY_TOKEN,
    PLAN_REPOSITORY_TOKEN,
} from '../catalog/tokens.js';
import { periodEndAfter } from './billing-period.js';
import { computeProration, type ProrationDto } from './proration.js';
import {
    SELF_SERVICE_BLOCKED_BUNDLES_TOKEN,
    type SelfServiceBlockedBundles,
} from './self-service-policy.js';
import {
    addMonths,
    resolveBundleCancelEffectiveAt,
    type SubscriptionBundleConfig,
} from './subscription-bundles.service.js';
import {
    SUBSCRIPTION_BUNDLE_CONFIG_TOKEN,
    SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN,
} from './subscription-bundles.tokens.js';

export interface SubscriptionBundlePreviewIssue {
    code: string;
    message: string;
}

/** Subscription-Kontext — der Controller liest ihn aus dem SubscriptionUsagePort. */
export interface SubscriptionBundlePreviewContext {
    subscriptionId: string;
    /** PlanKey der aktuellen Subscription (Plan-Kompat + Redundanz-Quelle). */
    currentPlanKey: string;
    /** 'MONTHLY' | 'YEARLY' (Port-Konvention). */
    billingCycle: string;
    /** Subscription-Status (TRIAL/ACTIVE/...). Im TRIAL keine Proration. */
    status: string;
    startedAt: Date | null;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
}

export interface BundlePreviewSnapshot {
    bundleKey: string;
    label: string;
    bundleVersionId: string;
    features: string[];
    quotas: Record<string, number>;
}

/** AK-13: Feature ist bereits anderweitig bezahlt — Doppelbezahlungs-Hinweis. */
export interface RedundantFeatureHint {
    featureKey: string;
    coveredBy: 'PLAN' | 'BUNDLE';
    /** planKey bzw. bundleKey der deckenden Quelle. */
    coveredByKey: string;
}

export interface SubscriptionBundleAddPreviewDto {
    action: 'add';
    bundle: BundlePreviewSnapshot;
    billingCycle: string;
    /**
     * Anteiliger Betrag bis Periodenende. `null` im TRIAL (noch keine
     * bezahlte Periode) oder ohne Listenpreis für den Zyklus.
     */
    proration: ProrationDto | null;
    /** Listenpreis pro Folgeperiode im aktuellen Zyklus; null = kein Preis gepflegt. */
    nextPeriodPriceNet: number | null;
    minimumTermMonths: number;
    /** Projiziertes Mindestlaufzeit-Ende ab `now`; null = keine Mindestlaufzeit. */
    minimumTermEndsAt: Date | null;
    redundantFeatures: RedundantFeatureHint[];
    /**
     * requires-Features (#35), die weder Plan noch aktive Bundles noch das
     * Bundle selbst decken. Nicht-leer ⇒ Blocker
     * BUNDLE_FEATURE_DEPENDENCY_UNSATISFIED.
     */
    missingRequires: string[];
    blockers: SubscriptionBundlePreviewIssue[];
    warnings: SubscriptionBundlePreviewIssue[];
}

export interface SubscriptionBundleCancelPreviewDto {
    action: 'cancel';
    subscriptionBundleId: string;
    bundle: BundlePreviewSnapshot;
    billingCycle: string;
    /** Wirksamkeits-Datum = max(currentPeriodEnd, minimumTermEndsAt). */
    effectiveAt: Date;
    /** Ersparnis pro Periode ab Wirksamkeit; null = kein Preis gepflegt. */
    nextPeriodSavingsNet: number | null;
    blockers: SubscriptionBundlePreviewIssue[];
    warnings: SubscriptionBundlePreviewIssue[];
}

@Injectable()
export class SubscriptionBundlePreviewService {
    private readonly defaultMinTermMonths: number;

    constructor(
        @Inject(SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN)
        private readonly subscriptionBundles: SubscriptionBundleRepository,
        @Inject(BUNDLE_REPOSITORY_TOKEN)
        private readonly bundles: BundleRepository,
        // Optional — Plan-Features für Redundanz-Hinweis + requires-Deckung.
        // Ohne Adapter zählt nur die Bundle-Sicht (graceful).
        @Optional()
        @Inject(PLAN_REPOSITORY_TOKEN)
        private readonly plans: PlanRepository | null = null,
        // Optional — requires-Quelle (kuratierte FeatureCatalogEntries).
        // Ohne Adapter entfällt der Dependency-Check (graceful).
        @Optional()
        @Inject(CATALOG_ENTRY_REPOSITORY_TOKEN)
        private readonly catalogEntries: CatalogEntryRepository | null = null,
        @Optional()
        @Inject(SELF_SERVICE_BLOCKED_BUNDLES_TOKEN)
        private readonly blockedBundles: SelfServiceBlockedBundles | null = null,
        @Optional()
        @Inject(SUBSCRIPTION_BUNDLE_CONFIG_TOKEN)
        config: SubscriptionBundleConfig = {},
    ) {
        this.defaultMinTermMonths = config.defaultMinimumTermMonths ?? 12;
    }

    async previewAdd(
        ctx: SubscriptionBundlePreviewContext,
        input: { bundleVersionId: string; minimumTermMonths?: number },
        now = new Date(),
    ): Promise<SubscriptionBundleAddPreviewDto> {
        const bundleVersion = await this.bundles.findVersionById(input.bundleVersionId);
        if (!bundleVersion) {
            throw new NotFoundException(`BundleVersion '${input.bundleVersionId}' nicht gefunden`);
        }

        const blockers: SubscriptionBundlePreviewIssue[] = [];
        const warnings: SubscriptionBundlePreviewIssue[] = [];

        this.collectBookabilityBlockers(bundleVersion, ctx.currentPlanKey, blockers);

        const activeBundleVersions = await this.loadActiveBundleVersions(ctx.subscriptionId);
        if (activeBundleVersions.some((bv) => bv.id === bundleVersion.id)) {
            blockers.push({
                code: 'BUNDLE_ALREADY_SUBSCRIBED',
                message: 'Dieses Bundle ist bereits aktiv gebucht.',
            });
        }

        const planFeatures = new Set(await this.resolvePlanFeatures(ctx.currentPlanKey, now));
        const redundantFeatures = this.collectRedundantFeatures(
            bundleVersion,
            planFeatures,
            ctx.currentPlanKey,
            activeBundleVersions,
        );
        if (redundantFeatures.length > 0) {
            warnings.push({
                code: 'REDUNDANT_FEATURES',
                message:
                    `${redundantFeatures.length} Feature${redundantFeatures.length === 1 ? ' ist' : 's sind'} ` +
                    'bereits im Plan oder einem anderen gebuchten Bundle enthalten — ' +
                    'das Bundle würde dafür doppelt bezahlt.',
            });
        }

        const missingRequires = await this.collectMissingRequires(
            bundleVersion,
            planFeatures,
            activeBundleVersions,
        );
        if (missingRequires.length > 0) {
            blockers.push({
                code: 'BUNDLE_FEATURE_DEPENDENCY_UNSATISFIED',
                message:
                    `Das Bundle benötigt [${missingRequires.join(', ')}] — weder im Plan ` +
                    'noch in den aktiven Bundles enthalten.',
            });
        }

        const priceNet = resolveBundlePriceNet(bundleVersion, ctx.currentPlanKey, ctx.billingCycle);
        const proration =
            ctx.status !== 'TRIAL' && priceNet !== null
                ? computeProration({
                      periodStart: ctx.currentPeriodStart ?? ctx.startedAt ?? now,
                      periodEnd:
                          ctx.currentPeriodEnd ??
                          periodEndAfter(ctx.startedAt, ctx.billingCycle as BillingCycle, now),
                      now,
                      currentPriceNet: 0,
                      targetPriceNet: priceNet,
                  })
                : null;

        const minimumTermMonths = input.minimumTermMonths ?? this.defaultMinTermMonths;

        return {
            action: 'add',
            bundle: toSnapshot(bundleVersion),
            billingCycle: ctx.billingCycle,
            proration,
            nextPeriodPriceNet: priceNet,
            minimumTermMonths,
            minimumTermEndsAt: minimumTermMonths > 0 ? addMonths(now, minimumTermMonths) : null,
            redundantFeatures,
            missingRequires,
            blockers,
            warnings,
        };
    }

    async previewCancel(
        ctx: SubscriptionBundlePreviewContext,
        input: { subscriptionBundleId: string },
        now = new Date(),
    ): Promise<SubscriptionBundleCancelPreviewDto> {
        const existing = await this.subscriptionBundles.findById(input.subscriptionBundleId);
        if (!existing || existing.subscriptionId !== ctx.subscriptionId) {
            throw new NotFoundException(
                `SubscriptionBundle '${input.subscriptionBundleId}' nicht gefunden`,
            );
        }
        const bundleVersion = await this.bundles.findVersionById(existing.bundleVersionId);
        if (!bundleVersion) {
            throw new NotFoundException(
                `BundleVersion '${existing.bundleVersionId}' nicht gefunden`,
            );
        }

        const blockers: SubscriptionBundlePreviewIssue[] = [];
        const warnings: SubscriptionBundlePreviewIssue[] = [];
        if (existing.canceledAt !== null) {
            blockers.push({
                code: 'SUBSCRIPTION_BUNDLE_ALREADY_CANCELED',
                message: 'Diese Bundle-Buchung ist bereits gekündigt.',
            });
        }

        const effectiveAt = resolveBundleCancelEffectiveAt({
            canceledAt: now,
            currentPeriodEnd: ctx.currentPeriodEnd,
            minimumTermEndsAt: existing.minimumTermEndsAt,
        });
        const periodEnd = ctx.currentPeriodEnd ?? now;
        if (existing.minimumTermEndsAt && existing.minimumTermEndsAt.getTime() > periodEnd.getTime()) {
            warnings.push({
                code: 'MINIMUM_TERM_BINDS',
                message:
                    'Die Mindestlaufzeit bindet über das Periodenende hinaus — die ' +
                    'Kündigung wirkt erst zum Mindestlaufzeit-Ende.',
            });
        }

        return {
            action: 'cancel',
            subscriptionBundleId: existing.id,
            bundle: toSnapshot(bundleVersion),
            billingCycle: ctx.billingCycle,
            effectiveAt,
            nextPeriodSavingsNet: resolveBundlePriceNet(
                bundleVersion,
                ctx.currentPlanKey,
                ctx.billingCycle,
            ),
            blockers,
            warnings,
        };
    }

    /** Buchbarkeits-Checks — gleiche Codes wie `addBundleToSubscription` (422-Pfad). */
    private collectBookabilityBlockers(
        bundleVersion: BundleVersionRow,
        currentPlanKey: string,
        blockers: SubscriptionBundlePreviewIssue[],
    ): void {
        if (bundleVersion.publishedAt === null) {
            blockers.push({
                code: 'BUNDLE_VERSION_NOT_PUBLISHED',
                message: 'Diese BundleVersion ist nicht veröffentlicht und nicht buchbar.',
            });
        }
        if (bundleVersion.supersededAt !== null) {
            blockers.push({
                code: 'BUNDLE_VERSION_SUPERSEDED',
                message: 'Diese BundleVersion wurde durch eine Nachfolge-Version abgelöst.',
            });
        }
        const planIds = bundleVersion.compatibility?.planIds ?? [];
        if (planIds.length > 0 && !planIds.includes(currentPlanKey)) {
            blockers.push({
                code: 'BUNDLE_INCOMPATIBLE_WITH_PLAN',
                message:
                    `Das Bundle ist nicht mit Plan '${currentPlanKey}' kompatibel. ` +
                    `Erlaubt: [${planIds.join(', ')}].`,
            });
        }
        if (this.blockedBundles?.bundleKeys?.includes(bundleVersion.bundleKey)) {
            blockers.push({
                code: 'BUNDLE_NOT_SELF_SERVICE',
                message:
                    `Bundle '${bundleVersion.bundleKey}' wird nur per Sondervertrag aktiviert. ` +
                    'Bitte den Vertragsbetreuer kontaktieren.',
            });
        }
    }

    /** Versions der aktiven Bundle-Buchungen (für Redundanz + requires-Deckung). */
    private async loadActiveBundleVersions(subscriptionId: string): Promise<BundleVersionRow[]> {
        const active = await this.subscriptionBundles.listActiveBySubscription(subscriptionId);
        const versions = await Promise.all(
            active.map((booking) => this.bundles.findVersionById(booking.bundleVersionId)),
        );
        return versions.filter((bv): bv is BundleVersionRow => bv !== null);
    }

    /** Features des aktuell live PlanVersion-Stands; ohne PlanRepository leer. */
    private async resolvePlanFeatures(planKey: string, asOf: Date): Promise<string[]> {
        if (!this.plans) return [];
        const live =
            (await this.plans.findActivePlanVersion?.(planKey, asOf)) ??
            (await this.plans.findLatestLivePlanVersion?.(planKey));
        return live?.features ?? [];
    }

    private collectRedundantFeatures(
        bundleVersion: BundleVersionRow,
        planFeatures: ReadonlySet<string>,
        currentPlanKey: string,
        activeBundleVersions: BundleVersionRow[],
    ): RedundantFeatureHint[] {
        const hints: RedundantFeatureHint[] = [];
        for (const featureKey of bundleVersion.features ?? []) {
            if (planFeatures.has(featureKey)) {
                hints.push({ featureKey, coveredBy: 'PLAN', coveredByKey: currentPlanKey });
                continue;
            }
            const coveringBundle = activeBundleVersions.find((bv) =>
                (bv.features ?? []).includes(featureKey),
            );
            if (coveringBundle) {
                hints.push({
                    featureKey,
                    coveredBy: 'BUNDLE',
                    coveredByKey: coveringBundle.bundleKey,
                });
            }
        }
        return hints;
    }

    /**
     * requires des neuen Bundles, die weder das Bundle selbst noch Plan ∪
     * aktive Bundles decken (#35). Ohne CatalogEntryRepository leer.
     */
    private async collectMissingRequires(
        bundleVersion: BundleVersionRow,
        planFeatures: ReadonlySet<string>,
        activeBundleVersions: BundleVersionRow[],
    ): Promise<string[]> {
        if (!this.catalogEntries) return [];
        const projectKey = await this.resolveProjectKey(bundleVersion);
        if (!projectKey) return [];
        const entries = await this.catalogEntries.listFeatures({ projectKey });
        const requiresIndex = buildFeatureRequiresIndex(entries);
        const covered = new Set<string>([
            ...planFeatures,
            ...activeBundleVersions.flatMap((bv) => bv.features ?? []),
        ]);
        return collectUnsatisfiedRequires(bundleVersion.features ?? [], requiresIndex).filter(
            (key) => !covered.has(key),
        );
    }

    /** `projectKey` lebt am Bundle-Stamm, nicht an der Version. */
    private async resolveProjectKey(bundleVersion: BundleVersionRow): Promise<string | null> {
        const stem = await this.bundles.findById(bundleVersion.bundleId);
        return stem?.projectKey ?? null;
    }
}

/**
 * Listenpreis (netto) für den Abrechnungszyklus inkl. plan-spezifischem
 * Pricing-Override (BundlePricingOverride mit `planId`, ohne
 * `businessTypeKey`). null = kein Preis für den Zyklus gepflegt.
 */
export function resolveBundlePriceNet(
    bundleVersion: BundleVersionRow,
    planKey: string,
    billingCycle: string,
): number | null {
    const override = (bundleVersion.pricingOverrides ?? []).find(
        (o) => o.planId === planKey && !o.businessTypeKey,
    );
    const yearly = billingCycle === 'YEARLY';
    const raw = yearly
        ? (override?.yearlyNet !== undefined ? override.yearlyNet : bundleVersion.yearlyNet)
        : (override?.monthlyNet !== undefined ? override.monthlyNet : bundleVersion.monthlyNet);
    if (raw === null || raw === undefined) return null;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : null;
}

function toSnapshot(bundleVersion: BundleVersionRow): BundlePreviewSnapshot {
    return {
        bundleKey: bundleVersion.bundleKey,
        label: bundleVersion.label,
        bundleVersionId: bundleVersion.id,
        features: [...(bundleVersion.features ?? [])],
        quotas: { ...(bundleVersion.quotas ?? {}) },
    };
}
