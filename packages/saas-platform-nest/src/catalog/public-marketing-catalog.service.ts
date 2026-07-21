// PublicMarketingCatalogService — auth-free marketing projection for the
// website (pricing page). Merges marketed plans + live PlanVersion pricing
// + MarketingProjection (locale) + active promotions + comparison matrix.
//
// Top-feature labels with a `key` reference are locale-resolved here
// (`FeatureCatalogEntry`/`QuotaCatalogEntry` i18n) — the card stays
// language-reactive.

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
    /** Code-discovered feature dependencies (#35) from the FeatureCatalogEntry. */
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
        // Optional — supplies readable, translated feature/quota labels for
        // top features + matrix. If the adapter is missing, falls back to the keys.
        @Optional()
        @Inject(CATALOG_ENTRY_REPOSITORY_TOKEN)
        private readonly catalogEntryRepo: CatalogEntryRepository | null = null,
        // P11.7.3 + P11.7.4 — bundle display in the public catalog. Optional;
        // without the adapter, `bundles: []` remains (plan-only marketing).
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
        // `findActivePlanVersion` is time-aware (validFrom/validUntil);
        // falls back to `findLatestLivePlanVersion` for adapters not yet
        // raised to SPEC_V2 §4.2 (validity period).
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
        // requiresFeatures (#35): index built once per request from the loaded
        // FeatureCatalogEntries — empty without a CatalogEntryRepository → [].
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
     * Loads all published-and-live bundle versions for a project and
     * filters on `marketed === true`. Without a registered
     * `BundleRepository` (apps without the SuperAdmin bundle editor) the
     * list is empty — the public catalog stays plan-only.
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
     * Maps BundleVersionRow → PublicMarketingBundle. Locale resolution
     * runs via `MarketingProjectionRepository.findByTarget('BUNDLE',
     * bundleVersionId, locale)` — on a miss it falls back to
     * `DEFAULT_LOCALE`. If the fallback is missing too, label/description
     * come directly from the bundle root (denormalized in `BundleVersionRow`).
     *
     * If the marketing projection is `visible === false`, the bundle is
     * hidden from the public response (preparation phase).
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
     * Labels for bundle features ∪ their requires (#48): `comparison.features`
     * only covers the plan-feature union — bundle-only features would
     * otherwise get no label in the public payload. Curated keys only;
     * without a CatalogEntryRepository the map stays empty (frontends fall
     * back to the key).
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

    /** Loads the translated feature/quota labels (+ sortOrder) for a locale. */
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
     * Resolves the displayed label of a top feature: the `label` override
     * wins; otherwise the translated label of the referenced `key`.
     */
    private resolveTopFeature(tf: MarketingTopFeature, meta: LabelMeta): MarketingTopFeature {
        let key = tf.key;
        let override = (tf.label ?? '').trim();
        // Migration: legacy entries without a `key` whose `label` is itself a
        // known feature/quota key are treated as key-referenced — so even
        // unmigrated data gets locale-resolved.
        if (!key && override && (meta.features.has(override) || meta.quotas.has(override))) {
            key = override;
            override = '';
        }
        if (override) return { key, label: override, strong: tf.strong ?? '' };
        const resolved =
            (key && (meta.features.get(key)?.label ?? meta.quotas.get(key)?.label)) || key || '';
        return { key, label: resolved, strong: tf.strong ?? '' };
    }

    /** Row definitions of the comparison matrix (feature/quota union + labels). */
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

        // Staircase sort: features with the broadest plan coverage first,
        // on a tie those contained in the leading plan columns first
        // (column order = payload order of the plans), then by label.
        // Frontends render the rows in payload order — producing the same
        // staircase matrix everywhere as in the AdminUI plan comparison.
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
