// PublicMarketingCatalogService — auth-freie Marketing-Projektion für die
// Webseite (Pricing-Page). Merged marketed Plans + Live-PlanVersion-Pricing
// + MarketingProjection (Locale) + aktive Promotions + Vergleichs-Matrix.
//
// Top-Feature-Labels mit `key`-Referenz werden hier locale-aufgelöst
// (`FeatureCatalogEntry`/`QuotaCatalogEntry` i18n) — die Karte bleibt
// sprach-reaktiv.

import { Inject, Injectable, Optional } from '@nestjs/common';
import {
    applyPromo,
    buildFeatureRequiresIndex,
    collectUnsatisfiedRequires,
    pickActivePromo,
    type BundleRepository,
    type BundleVersionRow,
    type CatalogEntryRepository,
    type FeatureRequiresIndex,
    type MarketingProjectionRepository,
    type MarketingTopFeature,
    type PlanRepository,
    type PromotionRepository,
    type PromotionRow,
    type PublicComparisonRow,
    type PublicMarketingBundle,
    type PublicMarketingCatalogResponse,
    type PublicMarketingPlan,
    type PublicMarketingPromo,
} from '@saasicat/types';

import {
    BUNDLE_REPOSITORY_TOKEN,
    CATALOG_ENTRY_REPOSITORY_TOKEN,
    MARKETING_PROJECTION_REPOSITORY_TOKEN,
    PLAN_REPOSITORY_TOKEN,
    PROMOTION_REPOSITORY_TOKEN,
} from './tokens.js';

const DEFAULT_LOCALE = 'de';

function toNumber(decimal: string | null): number | null {
    if (decimal === null) return null;
    const n = Number.parseFloat(decimal);
    return Number.isFinite(n) ? n : null;
}

interface FeatureMeta {
    label: string;
    sortOrder: number;
    /** Code-discoverte Feature-Abhängigkeiten (#35) aus dem FeatureCatalogEntry. */
    requires: string[];
}
interface QuotaMeta {
    label: string;
    unit: string;
    sortOrder: number;
}
interface LabelMeta {
    features: Map<string, FeatureMeta>;
    quotas: Map<string, QuotaMeta>;
}

@Injectable()
export class PublicMarketingCatalogService {
    constructor(
        @Inject(PLAN_REPOSITORY_TOKEN)
        private readonly planRepo: PlanRepository,
        @Inject(MARKETING_PROJECTION_REPOSITORY_TOKEN)
        private readonly marketingRepo: MarketingProjectionRepository,
        @Inject(PROMOTION_REPOSITORY_TOKEN)
        private readonly promotionRepo: PromotionRepository,
        // Optional — liefert lesbare, übersetzte Feature-/Quota-Labels für
        // Top-Features + Matrix. Fehlt der Adapter, Fallback auf die Keys.
        @Optional()
        @Inject(CATALOG_ENTRY_REPOSITORY_TOKEN)
        private readonly catalogEntryRepo: CatalogEntryRepository | null = null,
        // P11.7.3 + P11.7.4 — Bundle-Anzeige im Public-Catalog. Optional;
        // ohne Adapter bleibt `bundles: []` (Plan-only-Vermarktung).
        @Optional()
        @Inject(BUNDLE_REPOSITORY_TOKEN)
        private readonly bundleRepo: BundleRepository | null = null,
    ) {}

    async getCatalog(
        projectKey: string,
        locale: string,
        currency: string,
        vatRate: number,
        asOf: Date = new Date(),
    ): Promise<PublicMarketingCatalogResponse> {
        const empty = { features: [], quotas: [] };
        // `findActivePlanVersion` ist zeit-bewusst (validFrom/validUntil);
        // Fallback auf `findLatestLivePlanVersion` für Adapter, die noch
        // nicht auf SPEC_V2 §4.2 (Gültigkeitszeitraum) gehoben sind.
        const findActive = this.planRepo.findActivePlanVersion?.bind(this.planRepo);
        const findLatest = this.planRepo.findLatestLivePlanVersion?.bind(this.planRepo);
        if (!findActive && !findLatest) {
            return {
                projectKey,
                locale,
                currency,
                vatRate,
                plans: [],
                bundles: [],
                comparison: empty,
            };
        }
        const resolveVersion = findActive
            ? (planKey: string) => findActive(planKey, asOf)
            : (planKey: string) => findLatest!(planKey);

        const [plans, promotions, labelMeta, marketedBundles] = await Promise.all([
            this.planRepo.list({ projectKey }),
            this.promotionRepo.list({ projectKey }),
            this.loadLabelMeta(projectKey, locale),
            this.loadMarketedBundles(projectKey),
        ]);
        const out: PublicMarketingPlan[] = [];

        for (const plan of plans) {
            const live = await resolveVersion(plan.planKey);
            if (!live) continue;

            const marketing =
                (await this.marketingRepo.findByTarget('PLAN', live.id, locale)) ??
                (locale === DEFAULT_LOCALE
                    ? null
                    : await this.marketingRepo.findByTarget('PLAN', live.id, DEFAULT_LOCALE));
            if (!marketing || marketing.visible === false) continue;

            const monthlyNet = toNumber(live.monthlyNet);
            const yearlyNet = toNumber(live.yearlyNet);

            out.push({
                planKey: plan.planKey,
                label: marketing.displayLabel || plan.label,
                planVersionId: live.id,
                monthlyNet,
                yearlyNet,
                badge: marketing.badge ?? '',
                description: marketing.description ?? '',
                highlight: marketing.highlight ?? false,
                priceTag: marketing.priceTag ?? null,
                ctaLabel: marketing.ctaLabel ?? null,
                trialEnabled: marketing.trialEnabled ?? false,
                trialDays: marketing.trialDays ?? 30,
                topFeatures: (marketing.topFeatures ?? []).map((tf) =>
                    this.resolveTopFeature(tf, labelMeta),
                ),
                priority: marketing.priority ?? 0,
                promo: this.resolvePromo(
                    promotions,
                    plan.planKey,
                    'PLAN',
                    locale,
                    monthlyNet,
                    yearlyNet,
                    asOf,
                ),
                features: [...(live.features ?? [])],
                quotas: { ...(live.quotas ?? {}) },
            });
        }

        out.sort((a, b) => b.priority - a.priority);
        // requiresFeatures (#35): Index einmal pro Request aus den geladenen
        // FeatureCatalogEntries — ohne CatalogEntryRepository leer → [].
        const requiresIndex = buildFeatureRequiresIndex(
            [...labelMeta.features].map(([featureKey, meta]) => ({
                featureKey,
                requires: meta.requires,
            })),
        );
        const publicBundles = (
            await Promise.all(
                marketedBundles.map((bv) =>
                    this.toPublicBundle(bv, promotions, locale, asOf, requiresIndex, labelMeta),
                ),
            )
        ).filter((bundle): bundle is PublicMarketingBundle => bundle !== null);
        return {
            projectKey,
            locale,
            currency,
            vatRate,
            plans: out,
            bundles: publicBundles,
            comparison: this.buildComparison(out, labelMeta),
        };
    }

    /**
     * Lädt alle published-and-live Bundle-Versions für ein Project und
     * filtert auf `marketed === true`. Ohne registriertes
     * `BundleRepository` (Apps ohne SuperAdmin-Bundle-Editor) leere
     * Liste — Public-Catalog bleibt Plan-only.
     */
    private async loadMarketedBundles(projectKey: string): Promise<BundleVersionRow[]> {
        if (!this.bundleRepo) return [];
        const bundles = await this.bundleRepo.list({ projectKey, excludeDeleted: true });
        const out: BundleVersionRow[] = [];
        for (const bundle of bundles) {
            const live = await this.bundleRepo.findLatestLive(bundle.id);
            if (live && live.marketed) {
                out.push(live);
            }
        }
        return out;
    }

    /**
     * Map BundleVersionRow → PublicMarketingBundle. Locale-Auflösung
     * läuft über `MarketingProjectionRepository.findByTarget('BUNDLE',
     * bundleVersionId, locale)` — bei Fehlen wird auf `DEFAULT_LOCALE`
     * gefallback. Wenn auch der Fallback fehlt, kommen Label/Description
     * direkt aus dem Bundle-Stamm (denormalisiert in `BundleVersionRow`).
     *
     * Wenn die Marketing-Projection `visible === false` ist, wird das
     * Bundle aus der Public-Antwort ausgeblendet (Vorbereitungs-Phase).
     */
    private async toPublicBundle(
        bv: BundleVersionRow,
        promotions: PromotionRow[],
        locale: string,
        asOf: Date,
        requiresIndex: FeatureRequiresIndex,
        labelMeta: LabelMeta,
    ): Promise<PublicMarketingBundle | null> {
        const marketing =
            (await this.marketingRepo.findByTarget('BUNDLE', bv.id, locale)) ??
            (locale === DEFAULT_LOCALE
                ? null
                : await this.marketingRepo.findByTarget('BUNDLE', bv.id, DEFAULT_LOCALE));
        if (marketing?.visible === false) return null;
        const features = [...(bv.features ?? [])];
        const requiresFeatures = collectUnsatisfiedRequires(features, requiresIndex);
        return {
            bundleKey: bv.bundleKey,
            label: marketing?.displayLabel || bv.label,
            bundleVersionId: bv.id,
            monthlyNet: toNumber(bv.monthlyNet),
            yearlyNet: toNumber(bv.yearlyNet),
            description: marketing?.description ?? '',
            priceTag: marketing?.priceTag ?? null,
            features,
            requiresFeatures,
            featureLabels: this.resolveBundleFeatureLabels(
                [...features, ...requiresFeatures],
                labelMeta,
            ),
            quotas: { ...(bv.quotas ?? {}) },
            promo: this.resolvePromo(
                promotions,
                bv.bundleKey,
                'BUNDLE',
                locale,
                toNumber(bv.monthlyNet),
                toNumber(bv.yearlyNet),
                asOf,
            ),
            compatiblePlanKeys: [...(bv.compatibility?.planIds ?? [])],
        };
    }

    /**
     * Labels für Bundle-Features ∪ deren requires (#48): `comparison.features`
     * deckt nur die Plan-Feature-Union ab — Bundle-only-Features bekämen im
     * Public-Payload sonst kein Label. Nur kuratierte Keys; ohne
     * CatalogEntryRepository bleibt die Map leer (Frontends fallen auf den
     * Key zurück).
     */
    private resolveBundleFeatureLabels(
        featureKeys: string[],
        meta: LabelMeta,
    ): Record<string, string> {
        const labels: Record<string, string> = {};
        for (const key of featureKeys) {
            const label = meta.features.get(key)?.label;
            if (label) labels[key] = label;
        }
        return labels;
    }

    /** Lädt die übersetzten Feature-/Quota-Labels (+ sortOrder) für eine Locale. */
    private async loadLabelMeta(projectKey: string, locale: string): Promise<LabelMeta> {
        const features = new Map<string, FeatureMeta>();
        const quotas = new Map<string, QuotaMeta>();
        if (!this.catalogEntryRepo) return { features, quotas };

        const [featureRows, quotaRows] = await Promise.all([
            this.catalogEntryRepo.listFeatures({ projectKey }),
            this.catalogEntryRepo.listQuotas({ projectKey }),
        ]);
        for (const f of featureRows) {
            features.set(f.featureKey, {
                label: f.i18n?.[locale]?.label || f.label || f.featureKey,
                sortOrder: f.sortOrder ?? 0,
                requires: f.requires ?? [],
            });
        }
        for (const q of quotaRows) {
            quotas.set(q.quotaKey, {
                label: q.i18n?.[locale]?.label || q.label || q.quotaKey,
                unit: q.i18n?.[locale]?.unit || q.unit || '',
                sortOrder: q.sortOrder ?? 0,
            });
        }
        return { features, quotas };
    }

    /**
     * Löst das angezeigte Label eines Top-Features auf: `label`-Override
     * gewinnt; sonst das übersetzte Label des referenzierten `key`.
     */
    private resolveTopFeature(tf: MarketingTopFeature, meta: LabelMeta): MarketingTopFeature {
        let key = tf.key;
        let override = (tf.label ?? '').trim();
        // Migration: Alt-Einträge ohne `key`, deren `label` selbst ein
        // bekannter Feature-/Quota-Key ist, werden key-referenziert behandelt
        // — so wird auch ungemigrierter Bestand locale-aufgelöst.
        if (!key && override && (meta.features.has(override) || meta.quotas.has(override))) {
            key = override;
            override = '';
        }
        if (override) return { key, label: override, strong: tf.strong ?? '' };
        const resolved =
            (key && (meta.features.get(key)?.label ?? meta.quotas.get(key)?.label)) || key || '';
        return { key, label: resolved, strong: tf.strong ?? '' };
    }

    /** Zeilen-Definitionen der Vergleichs-Matrix (Feature-/Quota-Union + Labels). */
    private buildComparison(
        plans: PublicMarketingPlan[],
        meta: LabelMeta,
    ): { features: PublicComparisonRow[]; quotas: PublicComparisonRow[] } {
        const featureKeys = new Set<string>();
        const quotaKeys = new Set<string>();
        for (const plan of plans) {
            for (const f of plan.features) featureKeys.add(f);
            for (const q of Object.keys(plan.quotas)) quotaKeys.add(q);
        }

        // Treppen-Sortierung: zuerst Features mit der breitesten Plan-Abdeckung,
        // bei Gleichstand zuerst die in den vorderen Plan-Spalten enthaltenen
        // (Spaltenreihenfolge = Payload-Reihenfolge der Pläne), dann Label.
        // Frontends rendern die Zeilen in Payload-Reihenfolge — so entsteht
        // überall dieselbe Treppenmatrix wie im AdminUI-Plan-Vergleich.
        const presence = new Map<string, { count: number; mask: string }>();
        for (const key of featureKeys) {
            let count = 0;
            let mask = '';
            for (const plan of plans) {
                const has = plan.features.includes(key);
                mask += has ? '1' : '0';
                if (has) count += 1;
            }
            presence.set(key, { count, mask });
        }
        const featureRows: PublicComparisonRow[] = [...featureKeys]
            .map((key) => ({ key, label: meta.features.get(key)?.label ?? key }))
            .sort((a, b) => {
                const pa = presence.get(a.key)!;
                const pb = presence.get(b.key)!;
                if (pa.count !== pb.count) return pb.count - pa.count;
                if (pa.mask !== pb.mask) return pb.mask.localeCompare(pa.mask);
                return a.label.localeCompare(b.label);
            });
        const quotaRows: PublicComparisonRow[] = [...quotaKeys]
            .map((key) => ({
                key,
                label: meta.quotas.get(key)?.label ?? key,
                unit: meta.quotas.get(key)?.unit ?? '',
            }))
            .sort(
                (a, b) =>
                    (meta.quotas.get(a.key)?.sortOrder ?? 0) -
                        (meta.quotas.get(b.key)?.sortOrder ?? 0) || a.label.localeCompare(b.label),
            );

        return { features: featureRows, quotas: quotaRows };
    }

    private resolvePromo(
        promotions: PromotionRow[],
        targetKey: string,
        targetType: 'PLAN' | 'BUNDLE' | 'OFFER',
        locale: string,
        monthlyNet: number | null,
        yearlyNet: number | null,
        asOf: Date,
    ): PublicMarketingPromo | null {
        const monthlyPromo = pickActivePromo(
            promotions,
            targetKey,
            locale,
            'monthly',
            asOf,
            targetType,
        );
        const yearlyPromo = pickActivePromo(
            promotions,
            targetKey,
            locale,
            'yearly',
            asOf,
            targetType,
        );
        const promo = monthlyPromo ?? yearlyPromo;
        if (!promo) return null;

        const monthlyResult = applyPromo(monthlyPromo, monthlyNet);
        const yearlyResult = applyPromo(yearlyPromo, yearlyNet);
        const i18n = promo.i18n?.[locale] ?? promo.i18n?.[DEFAULT_LOCALE] ?? {};

        return {
            type: promo.type,
            badge: i18n.badge ?? '',
            fineprint: i18n.fineprint ?? '',
            color: promo.color,
            discountedMonthlyNet: monthlyResult ? monthlyResult.discounted : null,
            discountedYearlyNet: yearlyResult ? yearlyResult.discounted : null,
        };
    }
}
