// Default-UpsellOfferResolver (#36) gegen die Catalog-Bundles.
//
// Löst fehlende Feature-Keys in Kaufangebote auf: alle published-and-live,
// marketed BundleVersions des Projects, die mindestens einen der fehlenden
// Keys enthalten. Sind `requires`-Daten verfügbar (CatalogEntryRepository,
// #35), werden Bundles höher gerankt, die zusätzlich die ungedeckten
// Abhängigkeiten der fehlenden Features mitliefern — ein Kombi-Bundle
// (z. B. SPORTPLATZ = Feature + Ressourcen-Modul) ist das bessere Angebot
// als das Feature-Bundle allein.
//
// Bewusst NICHT hart in den FeatureGuard verdrahtet: Konsumenten registrieren
// die Klasse explizit unter `UPSELL_OFFER_RESOLVER_TOKEN` (typisch im selben
// Modul, das die `PUBLIC_CATALOG_*`-Tokens bindet):
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
    /** Wie viele der gesuchten Keys (Features + deren requires) das Bundle deckt. */
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
        // Default-Implementierung ist tenant-agnostisch; die Port-Signatur
        // trägt die tenantId für tenant-bewusste Eigen-Implementierungen.
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
     * Ungedeckte Abhängigkeiten der fehlenden Features (#35) — fließen ins
     * Coverage-Ranking ein. Ohne CatalogEntryRepository: leer (Ranking
     * degradiert auf Preis).
     */
    private async lookupUnmetRequires(featureKeys: string[]): Promise<string[]> {
        if (!this.catalogEntryRepo) return [];
        const rows = await this.catalogEntryRepo.listFeatures({ projectKey: this.projectKey });
        return collectUnsatisfiedRequires(featureKeys, buildFeatureRequiresIndex(rows));
    }

    /** Nur published-and-live UND marketed — nicht vermarktete Bundles sind kein Angebot. */
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

/** Prisma-Decimal-Wire-Format (`string | null`) → Zahl; unparsebar = null. */
function parsePrice(decimal: string | null): number | null {
    if (decimal === null) return null;
    const n = Number.parseFloat(decimal);
    return Number.isFinite(n) ? n : null;
}

/**
 * Bestes Angebot zuerst: höchste Deckung (Feature + Abhängigkeiten),
 * dann günstigster Preis (preislose Overrides zuletzt), dann bundleKey
 * als deterministischer Tie-Breaker.
 */
function compareRankedOffers(a: RankedOffer, b: RankedOffer): number {
    if (a.coverage !== b.coverage) return b.coverage - a.coverage;
    const priceA = a.offer.priceMonthlyNet ?? Number.POSITIVE_INFINITY;
    const priceB = b.offer.priceMonthlyNet ?? Number.POSITIVE_INFINITY;
    if (priceA !== priceB) return priceA - priceB;
    return a.offer.bundleKey.localeCompare(b.offer.bundleKey);
}
