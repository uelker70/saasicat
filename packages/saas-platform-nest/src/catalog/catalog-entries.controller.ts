// CatalogEntriesController — REST-Endpunkte für den Discovery-Review
// (Capabilities, Features, Quotas + Übersetzungen + Snapshot-Sync).
//
// Pfad-Konvention: `/admin/catalog/{capabilities,features,quotas}` und
// `/admin/catalog/discovery/sync`. Wie BundlesController zur Boot-Zeit
// gebaut, damit der Konsument die Guards bestimmt.

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
            return this.service.listCapabilities(query.projectKey, query.codeStatus);
        }

        @Get('features')
        listFeatures(@Query() query: ListCatalogEntriesQueryDto) {
            return this.service.listFeatures(query.projectKey, query.discoveryStatus);
        }

        @Get('quotas')
        listQuotas(@Query() query: ListCatalogEntriesQueryDto) {
            return this.service.listQuotas(query.projectKey, query.discoveryStatus);
        }

        @Patch('features/:key/review')
        async reviewFeature(
            @Req() req: unknown,
            @Param('key') featureKey: string,
            @Query('projectKey') projectKey: string,
            @Body() dto: ReviewCatalogEntryDto,
        ) {
            const row = await this.service.reviewFeature(
                projectKey,
                featureKey,
                dto,
                this.audit?.resolveUserId(req) ?? null,
            );
            await this.audit?.logFromRequest(
                req,
                'CatalogFeatureEntry',
                `${projectKey}:${featureKey}`,
                'REVIEW_FEATURE',
                { discoveryStatus: dto.discoveryStatus },
            );
            return row;
        }

        @Patch('quotas/:key/review')
        async reviewQuota(
            @Req() req: unknown,
            @Param('key') quotaKey: string,
            @Query('projectKey') projectKey: string,
            @Body() dto: ReviewCatalogEntryDto,
        ) {
            const row = await this.service.reviewQuota(
                projectKey,
                quotaKey,
                dto,
                this.audit?.resolveUserId(req) ?? null,
            );
            await this.audit?.logFromRequest(
                req,
                'CatalogQuotaEntry',
                `${projectKey}:${quotaKey}`,
                'REVIEW_QUOTA',
                { discoveryStatus: dto.discoveryStatus },
            );
            return row;
        }

        @Patch('features/:key/i18n')
        async setFeatureI18n(
            @Req() req: unknown,
            @Param('key') featureKey: string,
            @Query('projectKey') projectKey: string,
            @Body() dto: UpdateCatalogEntryI18nDto,
        ) {
            const row = await this.service.setFeatureI18n(projectKey, featureKey, dto.i18n);
            await this.audit?.logFromRequest(
                req,
                'CatalogFeatureEntry',
                `${projectKey}:${featureKey}`,
                'SET_FEATURE_I18N',
                { locales: Object.keys(dto.i18n ?? {}) },
            );
            return row;
        }

        @Patch('quotas/:key/i18n')
        async setQuotaI18n(
            @Req() req: unknown,
            @Param('key') quotaKey: string,
            @Query('projectKey') projectKey: string,
            @Body() dto: UpdateCatalogEntryI18nDto,
        ) {
            const row = await this.service.setQuotaI18n(projectKey, quotaKey, dto.i18n);
            await this.audit?.logFromRequest(
                req,
                'CatalogQuotaEntry',
                `${projectKey}:${quotaKey}`,
                'SET_QUOTA_I18N',
                { locales: Object.keys(dto.i18n ?? {}) },
            );
            return row;
        }

        @Patch('features/:key')
        async setFeatureBase(
            @Req() req: unknown,
            @Param('key') featureKey: string,
            @Query('projectKey') projectKey: string,
            @Body() dto: UpdateCatalogEntryBaseDto,
        ) {
            const row = await this.service.setFeatureBase(projectKey, featureKey, dto);
            await this.audit?.logFromRequest(
                req,
                'CatalogFeatureEntry',
                `${projectKey}:${featureKey}`,
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
            @Query('projectKey') projectKey: string,
            @Body() dto: UpdateCatalogEntryBaseDto,
        ) {
            const row = await this.service.setQuotaBase(projectKey, quotaKey, dto);
            await this.audit?.logFromRequest(
                req,
                'CatalogQuotaEntry',
                `${projectKey}:${quotaKey}`,
                'SET_QUOTA_BASE',
                { label: dto.label, description: dto.description },
            );
            return row;
        }

        /** Upsertet die Catalog-Entries aus dem mitgelieferten Discovery-Snapshot. */
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
