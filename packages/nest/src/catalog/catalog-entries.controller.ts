// CatalogEntriesController — REST endpoints for the discovery review
// (Capabilities, Features, Quotas + translations + snapshot sync).
//
// Path convention: `/admin/catalog/{capabilities,features,quotas}` and
// `/admin/catalog/discovery/sync`. Built at boot time like BundlesController,
// so the consumer determines the guards.

import {
    Body,
    type CanActivate,
    Controller,
    Get,
    Inject,
    Optional,
    Param,
    Patch,
    Post,
    Query,
    Req,
    type Type,
    UseGuards,
} from '@nestjs/common';

import { WebAuditLogger } from '../core/web-audit.js';
import { CatalogEntriesService } from './catalog-entries.service.js';
import {
    ListCatalogEntriesQueryDto,
    ReviewCatalogEntryDto,
    SyncDiscoveryDto,
    UpdateCatalogEntryBaseDto,
    UpdateCatalogEntryI18nDto,
} from './dto/catalog-entries.dto.js';

export function buildCatalogEntriesController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin/catalog')
    @UseGuards(...guards)
    class GeneratedCatalogEntriesController {
        constructor(
            @Inject(CatalogEntriesService)
            private readonly service: CatalogEntriesService,
            @Optional()
            @Inject(WebAuditLogger)
            private readonly audit: WebAuditLogger | null = null,
        ) {}

        @Get('capabilities')
        listCapabilities(@Query() query: ListCatalogEntriesQueryDto) {
            return this.service.listCapabilities(query.codeStatus);
        }

        @Get('features')
        listFeatures(@Query() query: ListCatalogEntriesQueryDto) {
            return this.service.listFeatures(query.discoveryStatus);
        }

        @Get('quotas')
        listQuotas(@Query() query: ListCatalogEntriesQueryDto) {
            return this.service.listQuotas(query.discoveryStatus);
        }

        @Patch('features/:key/review')
        async reviewFeature(
            @Req() req: unknown,
            @Param('key') featureKey: string,
            @Body() dto: ReviewCatalogEntryDto,
        ) {
            const row = await this.service.reviewFeature(
                featureKey,
                dto,
                this.audit?.resolveUserId(req) ?? null,
            );
            await this.audit?.logFromRequest(
                req,
                'CatalogFeatureEntry',
                featureKey,
                'REVIEW_FEATURE',
                { discoveryStatus: dto.discoveryStatus },
            );
            return row;
        }

        @Patch('quotas/:key/review')
        async reviewQuota(
            @Req() req: unknown,
            @Param('key') quotaKey: string,
            @Body() dto: ReviewCatalogEntryDto,
        ) {
            const row = await this.service.reviewQuota(
                quotaKey,
                dto,
                this.audit?.resolveUserId(req) ?? null,
            );
            await this.audit?.logFromRequest(req, 'CatalogQuotaEntry', quotaKey, 'REVIEW_QUOTA', {
                discoveryStatus: dto.discoveryStatus,
            });
            return row;
        }

        @Patch('features/:key/i18n')
        async setFeatureI18n(
            @Req() req: unknown,
            @Param('key') featureKey: string,
            @Body() dto: UpdateCatalogEntryI18nDto,
        ) {
            const row = await this.service.setFeatureI18n(featureKey, dto.i18n);
            await this.audit?.logFromRequest(
                req,
                'CatalogFeatureEntry',
                featureKey,
                'SET_FEATURE_I18N',
                { locales: Object.keys(dto.i18n ?? {}) },
            );
            return row;
        }

        @Patch('quotas/:key/i18n')
        async setQuotaI18n(
            @Req() req: unknown,
            @Param('key') quotaKey: string,
            @Body() dto: UpdateCatalogEntryI18nDto,
        ) {
            const row = await this.service.setQuotaI18n(quotaKey, dto.i18n);
            await this.audit?.logFromRequest(req, 'CatalogQuotaEntry', quotaKey, 'SET_QUOTA_I18N', {
                locales: Object.keys(dto.i18n ?? {}),
            });
            return row;
        }

        @Patch('features/:key')
        async setFeatureBase(
            @Req() req: unknown,
            @Param('key') featureKey: string,
            @Body() dto: UpdateCatalogEntryBaseDto,
        ) {
            const row = await this.service.setFeatureBase(featureKey, dto);
            await this.audit?.logFromRequest(
                req,
                'CatalogFeatureEntry',
                featureKey,
                'SET_FEATURE_BASE',
                {
                    label: dto.label,
                    description: dto.description,
                    icon: dto.icon,
                    tier: dto.tier,
                },
            );
            return row;
        }

        @Patch('quotas/:key')
        async setQuotaBase(
            @Req() req: unknown,
            @Param('key') quotaKey: string,
            @Body() dto: UpdateCatalogEntryBaseDto,
        ) {
            const row = await this.service.setQuotaBase(quotaKey, dto);
            await this.audit?.logFromRequest(req, 'CatalogQuotaEntry', quotaKey, 'SET_QUOTA_BASE', {
                label: dto.label,
                description: dto.description,
            });
            return row;
        }

        /** Upserts the catalog entries from the supplied discovery snapshot. */
        @Post('discovery/sync')
        async syncDiscovery(@Req() req: unknown, @Body() dto: SyncDiscoveryDto) {
            const result = await this.service.syncFromSnapshot(dto.snapshot);
            await this.audit?.logFromRequest(
                req,
                'CatalogDiscovery',
                dto.snapshot.app.key,
                'SYNC_DISCOVERY',
                {
                    features: result.features,
                    quotas: result.quotas,
                    capabilities: result.capabilities,
                },
            );
            return result;
        }
    }

    return GeneratedCatalogEntriesController;
}
