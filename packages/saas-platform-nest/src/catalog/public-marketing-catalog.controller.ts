// PublicMarketingCatalogController — auth-freier Endpoint für die
// Webseiten-Pricing-Page: `GET /public/marketing-catalog?lang=de`.
//
// `projectKey` + `currency` sind beim Build gebunden (App-Identität);
// die Webseite übergibt nur `?lang=`.

import {
    type CanActivate,
    Controller,
    Get,
    Inject,
    Query,
    type Type,
    UseGuards,
} from '@nestjs/common';

import { PublicMarketingCatalogService } from './public-marketing-catalog.service.js';

export function buildPublicMarketingCatalogController(
    guards: Array<Type<CanActivate>>,
    projectKey: string,
    currency: string,
    vatRate: number,
): Type {
    @Controller('public/marketing-catalog')
    @UseGuards(...guards)
    class GeneratedPublicMarketingCatalogController {
        constructor(
            @Inject(PublicMarketingCatalogService)
            private readonly service: PublicMarketingCatalogService,
        ) {}

        /**
         * `?lang=de|tr|en` — Alias `locale` akzeptiert (SPEC_V2 §9).
         * `?asOf=YYYY-MM-DD` — Vorschau einer zukünftigen oder vergangenen
         *   Catalog-Variante. Default = heute. Liefert die PlanVersion, deren
         *   `validFrom`/`validUntil` `asOf` tag-inklusiv umfassen (validUntil-Tag
         *   gilt noch, vgl. buildActivePlanVersionWhere).
         */
        @Get()
        getCatalog(
            @Query('lang') lang?: string,
            @Query('locale') localeParam?: string,
            @Query('asOf') asOfParam?: string,
        ) {
            const locale = lang || localeParam || 'de';
            const asOf = parseAsOf(asOfParam);
            return this.service.getCatalog(projectKey, locale, currency, vatRate, asOf);
        }
    }

    return GeneratedPublicMarketingCatalogController;
}

/**
 * Akzeptiert ISO-Date (`2026-06-30`) oder ISO-Datetime; bei ungültigem
 * Wert oder undefined fallen wir auf "jetzt" zurück. Bewusst kein 400,
 * weil `asOf` ein Preview-Komfort-Param ist — die Default-Antwort
 * (= heute) ist immer noch korrekt.
 */
function parseAsOf(raw: string | undefined): Date {
    if (!raw) return new Date();
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? new Date() : d;
}
