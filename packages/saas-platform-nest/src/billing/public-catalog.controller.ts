import { Controller, Get, Inject, Optional, Query } from '@nestjs/common';
import {
    buildFeatureRequiresIndex,
    collectUnsatisfiedRequires,
    type BundleRepository,
    type BundleVersionRow,
    type BusinessTypeRepository,
    type BusinessTypeVersionRow,
    type CatalogEntryRepository,
    type FeatureRequiresIndex,
    type FeatureUiRegistry,
    type MarketingProjectionRepository,
    type MarketingProjectionRow,
    type MarketingTopFeature,
    type PlanCatalog,
} from '@saasicat/types';
import { PLAN_CATALOG_TOKEN } from './plan-catalog.module.js';
import { FEATURE_UI_REGISTRY_TOKEN } from './feature-ui-registry.tokens.js';
import {
    PUBLIC_CATALOG_BUNDLE_REPOSITORY_TOKEN,
    PUBLIC_CATALOG_BUSINESS_TYPE_REPOSITORY_TOKEN,
    PUBLIC_CATALOG_CATALOG_ENTRY_REPOSITORY_TOKEN,
    PUBLIC_CATALOG_MARKETING_REPOSITORY_TOKEN,
    PUBLIC_CATALOG_PROJECT_KEY_TOKEN,
} from './public-catalog.tokens.js';
import { getMarketedPlans } from './plan-helpers.js';

// PublicCatalogController — Auth-frei lesbarer Catalog für Marketing,
// Onboarding und Tenant-Self-Service-UIs.
//
// SPEC_V2 §11.1 M6 Pack 2c:
//   - GET /billing/plans?locale=de: Marketing-Merge optional (wenn
//     MarketingProjection-Repo + projectKey konfiguriert)
//   - GET /billing/bundles?locale=de: NEU (M6 Pack 2c)
//   - GET /billing/business-types?locale=de: NEU (M6 Pack 2c)

interface MarketingFields {
    displayLabel?: string;
    description?: string;
    visible?: boolean;
    badge?: string;
    topFeatures?: MarketingTopFeature[];
    trialEnabled?: boolean;
    trialDays?: number;
    priceTag?: string | null;
    ctaLabel?: string | null;
    highlight?: boolean;
    priority?: number;
}

interface PlanResponseEntry {
    id: string;
    name: string;
    tagline: string;
    monthlyNet: number | null;
    yearlyNet: number | null;
    popular: boolean;
    quotas: Record<string, number>;
    features: string[];
    /** SPEC_V2 §11.1 M6 — optional, kommt wenn MarketingProjection existiert. */
    marketing?: MarketingFields;
}

interface PublicBundleEntry {
    bundleVersionId: string;
    bundleKey: string;
    label: string;
    description: string | null;
    features: string[];
    quotas: Record<string, number>;
    monthlyNet: string | null;
    yearlyNet: string | null;
    /**
     * Ungedeckte Feature-Abhängigkeiten (#35): Union der `requires` der
     * enthaltenen Features minus der im Bundle selbst enthaltenen. Der
     * Konfigurator graut das Bundle aus, wenn diese Keys weder im Plan
     * noch in der aktuellen Auswahl liegen. Leer ohne
     * CatalogEntryRepository (keine requires-Daten verfügbar).
     */
    requiresFeatures: string[];
    marketing?: MarketingFields;
}

interface PublicBusinessTypeEntry {
    businessTypeVersionId: string;
    businessTypeKey: string;
    label: string;
    description: string | null;
    monthlyNet: string | null;
    yearlyNet: string | null;
    bundleKeys: string[];
    quotaOverrides: Record<string, number>;
    marketing?: MarketingFields;
}

@Controller('billing')
export class PublicCatalogController {
    constructor(
        @Inject(PLAN_CATALOG_TOKEN) private readonly planCatalog: PlanCatalog,
        @Inject(FEATURE_UI_REGISTRY_TOKEN) private readonly featureRegistry: FeatureUiRegistry,
        @Optional()
        @Inject(PUBLIC_CATALOG_PROJECT_KEY_TOKEN)
        private readonly projectKey: string | null = null,
        @Optional()
        @Inject(PUBLIC_CATALOG_MARKETING_REPOSITORY_TOKEN)
        private readonly marketingRepo: MarketingProjectionRepository | null = null,
        @Optional()
        @Inject(PUBLIC_CATALOG_BUNDLE_REPOSITORY_TOKEN)
        private readonly bundleRepo: BundleRepository | null = null,
        @Optional()
        @Inject(PUBLIC_CATALOG_BUSINESS_TYPE_REPOSITORY_TOKEN)
        private readonly businessTypeRepo: BusinessTypeRepository | null = null,
        @Optional()
        @Inject(PUBLIC_CATALOG_CATALOG_ENTRY_REPOSITORY_TOKEN)
        private readonly catalogEntryRepo: CatalogEntryRepository | null = null,
    ) {}

    @Get('plans')
    async listPlans(
        @Query('lang') lang?: string,
        @Query('locale') localeParam = 'de',
    ): Promise<PlanResponseEntry[]> {
        // SPEC_V2 §9 — `?lang=XX` ist der dokumentierte Query-Param,
        // `?locale=XX` bleibt als Alias akzeptiert.
        const locale = lang || localeParam;
        const plans = getMarketedPlans(this.planCatalog).map((plan) => ({
            id: plan.id,
            name: plan.name ?? plan.id,
            tagline: plan.tagline ?? '',
            monthlyNet: plan.monthlyNet ?? null,
            yearlyNet: plan.yearlyNet ?? null,
            popular: plan.popular ?? false,
            quotas: plan.quotas,
            features: plan.features,
        }));
        // Marketing-Merge: pro PlanVersion eine optionale Projection.
        // Aktuell nicht möglich, weil Plans im PublicCatalog nur planKey
        // tragen, kein PlanVersion-ID. Marketing-Lookup für Plan ist
        // daher in M6 Pack 2c noch ein No-op — sobald PlanVersion-IDs
        // im Catalog landen, wird hier geMerged.
        // (Bundles + BusinessTypes haben PlanVersion-IDs, dort funktioniert's.)
        void locale;
        return plans;
    }

    @Get('feature-registry')
    async listFeatureRegistry(): Promise<FeatureUiRegistry> {
        // Overlay (#13): editierbares FeatureCatalogEntry.icon aus der DB
        // gewinnt über das statische Registry-Icon; label/description bleiben
        // aus der Registry (Auto-Sync setzt label=featureKey-Fallback). DB-Fehler
        // dürfen den auth-freien Endpoint nicht brechen → Fallback auf Registry.
        if (!this.catalogEntryRepo || !this.projectKey) return this.featureRegistry;
        let rows;
        try {
            rows = await this.catalogEntryRepo.listFeatures({ projectKey: this.projectKey });
        } catch {
            return this.featureRegistry;
        }
        const byKey = new Map(rows.map((r) => [r.featureKey, r]));
        const merged: FeatureUiRegistry = {};
        for (const [key, meta] of Object.entries(this.featureRegistry)) {
            const dbIcon = byKey.get(key)?.icon;
            merged[key] = dbIcon ? { ...meta, icon: dbIcon } : meta;
        }
        // discovered-only Keys (in DB, nicht in der statischen Registry) ergänzen
        for (const row of rows) {
            if (merged[row.featureKey]) continue;
            merged[row.featureKey] = {
                label: row.label || row.featureKey,
                description: row.description ?? '',
                icon: row.icon ?? '',
                ...(row.plannedOnly ? { plannedOnly: true } : {}),
            };
        }
        return merged;
    }

    /**
     * SPEC_V2 §11.1 M6 Pack 2c — Public-Catalog-Endpoint für Bundles
     * (Stamm-Liste mit live-Versions). Wenn `MarketingProjection` mit
     * `targetType=BUNDLE` + passender locale existiert, wird sie
     * reingemerged.
     */
    @Get('bundles')
    async listBundles(
        @Query('lang') lang?: string,
        @Query('locale') localeParam = 'de',
    ): Promise<PublicBundleEntry[]> {
        const locale = lang || localeParam;
        if (!this.bundleRepo || !this.projectKey) return [];
        const stems = await this.bundleRepo.list({ projectKey: this.projectKey });
        const requiresIndex = await this.loadFeatureRequiresIndex();
        const out: PublicBundleEntry[] = [];
        for (const stem of stems) {
            const versions = await this.bundleRepo.listVersions(stem.id);
            const live = versions.find((v) => v.publishedAt !== null && v.supersededAt === null);
            if (!live) continue;
            const marketing = await this.lookupMarketing('BUNDLE', live.id, locale);
            out.push(this.toBundleEntry(stem.bundleKey, live, marketing, requiresIndex));
        }
        return out;
    }

    /**
     * `requires`-Daten für `requiresFeatures` (#35) — kommen aus den
     * FeatureCatalogEntries. Ohne CatalogEntryRepository bzw. bei DB-Fehlern
     * leerer Index: der auth-freie Endpoint darf daran nicht brechen,
     * `requiresFeatures` bleibt dann konservativ leer.
     */
    private async loadFeatureRequiresIndex(): Promise<FeatureRequiresIndex> {
        if (!this.catalogEntryRepo || !this.projectKey) return new Map();
        try {
            const rows = await this.catalogEntryRepo.listFeatures({ projectKey: this.projectKey });
            return buildFeatureRequiresIndex(rows);
        } catch {
            return new Map();
        }
    }

    /**
     * SPEC_V2 §11.1 M6 Pack 2c — Public-Catalog-Endpoint für BusinessTypes
     * (Stamm-Liste mit live-Versions + Bundle-Komposition + Marketing).
     */
    @Get('business-types')
    async listBusinessTypes(
        @Query('lang') lang?: string,
        @Query('locale') localeParam = 'de',
    ): Promise<PublicBusinessTypeEntry[]> {
        const locale = lang || localeParam;
        if (!this.businessTypeRepo || !this.bundleRepo || !this.projectKey) return [];
        const stems = await this.businessTypeRepo.list({ projectKey: this.projectKey });
        const out: PublicBusinessTypeEntry[] = [];
        for (const stem of stems) {
            const versions = await this.businessTypeRepo.listVersions(stem.id);
            const live = versions.find((v) => v.publishedAt !== null && v.supersededAt === null);
            if (!live) continue;
            const bundleKeys: string[] = [];
            for (const ref of live.bundles) {
                const bv = await this.bundleRepo.findVersionById(ref.bundleVersionId);
                if (bv) bundleKeys.push(bv.bundleKey);
            }
            const marketing = await this.lookupMarketing('BUSINESS_TYPE', live.id, locale);
            out.push({
                businessTypeVersionId: live.id,
                businessTypeKey: stem.businessTypeKey,
                label: stem.label,
                description: stem.description ?? null,
                monthlyNet: live.monthlyNet,
                yearlyNet: live.yearlyNet,
                bundleKeys,
                quotaOverrides: live.quotaOverrides as Record<string, number>,
                marketing,
            });
        }
        return out;
    }

    private async lookupMarketing(
        targetType: 'PLAN' | 'BUNDLE' | 'BUSINESS_TYPE',
        targetVersionId: string,
        locale: string,
    ): Promise<MarketingFields | undefined> {
        if (!this.marketingRepo || !this.projectKey) return undefined;
        const rows = await this.marketingRepo.list({
            projectKey: this.projectKey,
            targetType,
            targetVersionId,
            locale,
        });
        const row: MarketingProjectionRow | undefined = rows[0];
        if (!row) return undefined;
        return {
            displayLabel: row.displayLabel,
            description: row.description,
            visible: row.visible,
            badge: row.badge,
            topFeatures: row.topFeatures,
            trialEnabled: row.trialEnabled,
            trialDays: row.trialDays,
            priceTag: row.priceTag,
            ctaLabel: row.ctaLabel,
            highlight: row.highlight,
            priority: row.priority,
        };
    }

    private toBundleEntry(
        bundleKey: string,
        live: BundleVersionRow,
        marketing: MarketingFields | undefined,
        requiresIndex: FeatureRequiresIndex,
    ): PublicBundleEntry {
        const features = live.features as string[];
        return {
            bundleVersionId: live.id,
            bundleKey,
            label: live.label,
            description: null,
            features,
            quotas: live.quotas as Record<string, number>,
            monthlyNet: live.monthlyNet,
            yearlyNet: live.yearlyNet,
            requiresFeatures: collectUnsatisfiedRequires(features, requiresIndex),
            marketing,
        };
    }
}

export type { PlanResponseEntry, PublicBundleEntry, PublicBusinessTypeEntry, MarketingFields };

// Used type to avoid unused-import warning from type-only access:
void (null as unknown as BusinessTypeVersionRow);
