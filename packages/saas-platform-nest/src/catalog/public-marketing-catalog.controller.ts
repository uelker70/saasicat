// PublicMarketingCatalogController — auth-free endpoint for the
// website pricing page: `GET /public/marketing-catalog?lang=de`.
//
// `projectKey` + `currency` are bound at build time (app identity);
// the website passes only `?lang=`.

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
         * `?lang=de|tr|en` — alias `locale` accepted (SPEC_V2 §9).
         * `?asOf=YYYY-MM-DD` — preview of a future or past catalog variant.
         *   Default = today. Returns the PlanVersion whose `validFrom`/`validUntil`
         *   span `asOf` inclusively by day (the validUntil day still counts,
         *   cf. buildActivePlanVersionWhere).
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
 * Accepts an ISO date (`2026-06-30`) or ISO datetime; on an invalid value
 * or undefined we fall back to "now". Deliberately no 400, because `asOf`
 * is a preview convenience param — the default response (= today) is still
 * correct.
 */
function parseAsOf(raw: string | undefined): Date {
    if (!raw) return new Date();
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? new Date() : d;
}
