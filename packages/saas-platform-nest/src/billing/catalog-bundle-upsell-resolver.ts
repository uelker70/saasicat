// Default UpsellOfferResolver (#36) against the catalog bundles.
//
// Resolves missing feature keys into purchase offers: all published-and-live,
// marketed BundleVersions of the project that contain at least one of the
// missing keys. When `requires` data is available (CatalogEntryRepository,
// #35), bundles that additionally supply the uncovered dependencies of the
// missing features are ranked higher — a combo bundle
// (e.g. SPORTPLATZ = feature + resource module) is the better offer
// than the feature bundle alone.
//
// Deliberately NOT hard-wired into the FeatureGuard: consumers register the
// class explicitly under `UPSELL_OFFER_RESOLVER_TOKEN` (typically in the same
// module that binds the `PUBLIC_CATALOG_*` tokens):
//
//   { provide: UPSELL_OFFER_RESOLVER_TOKEN, useClass: CatalogBundleUpsellResolver }

import { Inject, Injectable, Optional } from '@nestjs/common';
import {
    buildFeatureRequiresIndex,
    collectUnsatisfiedRequires,
    type BundleRepository,
    type BundleVersionRow,
    type CatalogEntryRepository,
    type UpsellOffer,
    type UpsellOfferResolver,
} from '@saasicat/types';
import {
    PUBLIC_CATALOG_BUNDLE_REPOSITORY_TOKEN,
    PUBLIC_CATALOG_CATALOG_ENTRY_REPOSITORY_TOKEN,
    PUBLIC_CATALOG_PROJECT_KEY_TOKEN,
} from './public-catalog.tokens.js';
import { UPSELL_OFFER_CURRENCY_TOKEN } from './upsell.tokens.js';

const DEFAULT_CURRENCY = 'EUR';

interface RankedOffer {
    offer: UpsellOffer;
    /** How many of the wanted keys (features + their requires) the bundle covers. */
    coverage: number;
}

@Injectable()
export class CatalogBundleUpsellResolver implements UpsellOfferResolver {
    constructor(
        @Inject(PUBLIC_CATALOG_BUNDLE_REPOSITORY_TOKEN)
        private readonly bundleRepo: BundleRepository,
        @Inject(PUBLIC_CATALOG_PROJECT_KEY_TOKEN)
        private readonly projectKey: string,
        @Optional()
        @Inject(PUBLIC_CATALOG_CATALOG_ENTRY_REPOSITORY_TOKEN)
        private readonly catalogEntryRepo: CatalogEntryRepository | null = null,
        @Optional()
        @Inject(UPSELL_OFFER_CURRENCY_TOKEN)
        private readonly currency: string | null = null,
    ) {}

    async resolveOffers(featureKeys: string[], tenantId: string): Promise<UpsellOffer[]> {
        // Default implementation is tenant-agnostic; the port signature
        // carries the tenantId for tenant-aware custom implementations.
        void tenantId;
        if (featureKeys.length === 0) return [];

        const missing = new Set(featureKeys);
        const wanted = new Set([...featureKeys, ...(await this.lookupUnmetRequires(featureKeys))]);

        const ranked: RankedOffer[] = [];
        for (const live of await this.listLiveMarketedBundles()) {
            const features = live.features as string[];
            if (!features.some((key) => missing.has(key))) continue;
            ranked.push({
                offer: this.toOffer(live),
                coverage: features.filter((key) => wanted.has(key)).length,
            });
        }

        return ranked.sort(compareRankedOffers).map((r) => r.offer);
    }

    /**
     * Uncovered dependencies of the missing features (#35) — feed into the
     * coverage ranking. Without a CatalogEntryRepository: empty (ranking
     * degrades to price).
     */
    private async lookupUnmetRequires(featureKeys: string[]): Promise<string[]> {
        if (!this.catalogEntryRepo) return [];
        const rows = await this.catalogEntryRepo.listFeatures({ projectKey: this.projectKey });
        return collectUnsatisfiedRequires(featureKeys, buildFeatureRequiresIndex(rows));
    }

    /** Only published-and-live AND marketed — non-marketed bundles are not an offer. */
    private async listLiveMarketedBundles(): Promise<BundleVersionRow[]> {
        const stems = await this.bundleRepo.list({
            projectKey: this.projectKey,
            excludeDeleted: true,
        });
        const out: BundleVersionRow[] = [];
        for (const stem of stems) {
            const live = await this.bundleRepo.findLatestLive(stem.id);
            if (live?.marketed) out.push(live);
        }
        return out;
    }

    private toOffer(live: BundleVersionRow): UpsellOffer {
        return {
            bundleKey: live.bundleKey,
            bundleVersionId: live.id,
            priceMonthlyNet: parsePrice(live.monthlyNet),
            currency: this.currency ?? DEFAULT_CURRENCY,
            label: live.label,
        };
    }
}

/** Prisma decimal wire format (`string | null`) → number; unparsable = null. */
function parsePrice(decimal: string | null): number | null {
    if (decimal === null) return null;
    const n = Number.parseFloat(decimal);
    return Number.isFinite(n) ? n : null;
}

/**
 * Best offer first: highest coverage (feature + dependencies),
 * then cheapest price (priceless overrides last), then bundleKey
 * as a deterministic tie-breaker.
 */
function compareRankedOffers(a: RankedOffer, b: RankedOffer): number {
    if (a.coverage !== b.coverage) return b.coverage - a.coverage;
    const priceA = a.offer.priceMonthlyNet ?? Number.POSITIVE_INFINITY;
    const priceB = b.offer.priceMonthlyNet ?? Number.POSITIVE_INFINITY;
    if (priceA !== priceB) return priceA - priceB;
    return a.offer.bundleKey.localeCompare(b.offer.bundleKey);
}
