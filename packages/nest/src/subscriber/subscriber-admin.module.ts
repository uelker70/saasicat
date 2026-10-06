import {
    Body,
    type CanActivate,
    Controller,
    type DynamicModule,
    type ForwardReference,
    Get,
    HttpCode,
    Inject,
    Module,
    Param,
    Post,
    Query,
    Req,
    type Type,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
    IsBoolean,
    IsIn,
    IsOptional,
    IsString,
    MaxLength,
    MinLength,
    ValidateIf,
} from 'class-validator';
import {
    SUBSCRIBER_ATTENTION_PAGE_SIZE,
    type AdminSubscriberAttention,
    type AdminSubscriberCorrected,
    type AdminSubscriberHistoryEntry,
    type AdminTenantSubscriber,
    type RlsBypassPort,
    type SubscriberRepository,
} from '@saasicat/core';

import { AdminResourcesService } from '../admin/admin-resources.module.js';
import { RLS_BYPASS_PORT_TOKEN } from '../admin/admin.tokens.js';
import { EnforceMfa } from '../admin/enforce-mfa.decorator.js';
import { UseRouteGuards } from '../admin/use-route-guards.decorator.js';
import { asProvider, type ProviderSpec } from '../core/di.js';
import { WebAuditLogger } from '../core/web-audit.js';
import { AllowDuringMaintenance } from '../maintenance/allow-during-maintenance.js';
import { vatIdCheckOutcomeOf } from './subscriber-history.js';
import { SubscriberStandingService } from './subscriber-standing.service.js';
import { SubscriberService } from './subscriber.service.js';
import { SUBSCRIBER_REPOSITORY_TOKEN } from './subscriber.tokens.js';

/** The longest reason an operator writes for a correction: a sentence or two, not a file. */
const MAX_REASON_LENGTH = 500;

/** `GET admin/subscribers/attention?tenantId=…&tenantId=…` — the tenants of the page shown. */
export class SubscriberAttentionQueryDto {
    // A query string carries one value as a string and several as a list.
    @Transform(({ value }: { value: unknown }) => (Array.isArray(value) ? value : [value]))
    @IsArray()
    @ArrayMaxSize(SUBSCRIBER_ATTENTION_PAGE_SIZE)
    @IsString({ each: true })
    @MinLength(1, { each: true })
    tenantId: string[] = [];
}

/**
 * `POST admin/tenants/:slug/subscriber/identity` — a correction of the legal
 * identity of the same legal entity. A field left out keeps its value; `null`
 * clears a tax identifier. `kind` is the operator's declaration of what the
 * change is: a takeover by another entity is refused, not recorded as an edit.
 */
export class CorrectSubscriberIdentityDto {
    @IsIn(['correction', 'takeover'])
    kind!: 'correction' | 'takeover';

    @IsOptional()
    @IsString()
    legalName?: string;

    @IsOptional()
    @ValidateIf((_, value: unknown) => value !== null)
    @IsString()
    vatId?: string | null;

    @IsOptional()
    @ValidateIf((_, value: unknown) => value !== null)
    @IsString()
    taxNumber?: string | null;

    @IsString()
    @MaxLength(MAX_REASON_LENGTH)
    reason!: string;
}

/** `POST admin/tenants/:slug/subscriber/business-status` — whether it acts as a business, and why. */
export class ChangeSubscriberBusinessStatusDto {
    @ValidateIf((_, value: unknown) => value !== null)
    @IsBoolean()
    business!: boolean | null;

    @IsString()
    @MaxLength(MAX_REASON_LENGTH)
    reason!: string;
}

export interface SubscriberAdminModuleOptions {
    /** The same chain the tenant routes of the administration run behind. */
    guards: Array<Type<CanActivate>>;
    subscriberRepository: ProviderSpec<SubscriberRepository>;
    /**
     * Must bring `AdminResourcesService` into scope — the module that already
     * provides it, passed as the very object the application imports. The
     * `RlsBypassPort`, the plan catalogue's settings, the tax treatments and
     * the second factor have to be visible too; `SaaSiCatModule` provides them
     * globally.
     */
    imports: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
}

function buildSubscriberAdminController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin')
    @AllowDuringMaintenance()
    @UseRouteGuards(...guards)
    class GeneratedSubscriberAdminController {
        constructor(
            @Inject(AdminResourcesService)
            private readonly tenants: AdminResourcesService,
            @Inject(SubscriberStandingService)
            private readonly standing: SubscriberStandingService,
            @Inject(SubscriberService)
            private readonly subscribers: SubscriberService,
            @Inject(WebAuditLogger)
            private readonly audit: WebAuditLogger,
            // Required: without it the reads would run in the request's
            // row-level scope, and a subscriber a policy hides would read as one
            // the tenant does not have.
            @Inject(RLS_BYPASS_PORT_TOKEN)
            private readonly rlsBypass: RlsBypassPort,
        ) {}

        /** The tenant's subscriber, its tax details and what holds its next contract back. */
        @Get('tenants/:slug/subscriber')
        subscriberOf(@Param('slug') slug: string): Promise<AdminTenantSubscriber> {
            return this.rlsBypass.runWithBypass(async () => {
                const tenant = await this.tenants.getTenantDetail(slug);
                return this.standing.ofTenant(tenant.id);
            });
        }

        /** Every correction, change of country or business status, and check, the latest first. */
        @Get('tenants/:slug/subscriber/history')
        historyOf(
            @Param('slug') slug: string,
        ): Promise<{ entries: AdminSubscriberHistoryEntry[] }> {
            return this.rlsBypass.runWithBypass(async () => {
                const tenant = await this.tenants.getTenantDetail(slug);
                return { entries: await this.standing.historyOfTenant(tenant.id) };
            });
        }

        /**
         * Corrects the legal identity of the tenant's subscriber, with the
         * second factor. A VAT number it gives the subscriber is checked right
         * after, where a tax adapter decides, and the outcome is answered — the
         * correction stands whatever the check found.
         */
        @Post('tenants/:slug/subscriber/identity')
        @HttpCode(200)
        @EnforceMfa()
        correctIdentity(
            @Param('slug') slug: string,
            @Body() body: CorrectSubscriberIdentityDto,
            @Req() request: unknown,
        ): Promise<AdminSubscriberCorrected> {
            return this.rlsBypass.runWithBypass(async () => {
                const { tenantId, subscriberId } = await this.subscriberAt(slug);
                const corrected = await this.subscribers.correctIdentity(subscriberId, {
                    kind: body.kind,
                    legalName: body.legalName,
                    vatId: body.vatId,
                    taxNumber: body.taxNumber,
                    reason: body.reason,
                    correctedBy: this.audit.actorTagFromRequest(request),
                });
                await this.audit.logFromRequest(
                    request,
                    'Subscriber',
                    subscriberId,
                    'SUBSCRIBER_IDENTITY_CORRECTED',
                    {
                        tenantId,
                        fields: Object.keys(corrected.correction.corrected),
                        reason: corrected.correction.reason,
                    },
                );
                return {
                    subscriber: await this.standing.ofTenant(tenantId),
                    vatIdCheck: corrected.vatIdCheck && vatIdCheckOutcomeOf(corrected.vatIdCheck),
                };
            });
        }

        /** Records whether the tenant's subscriber acts as a business, and why, with the second factor. */
        @Post('tenants/:slug/subscriber/business-status')
        @HttpCode(200)
        @EnforceMfa()
        changeBusinessStatus(
            @Param('slug') slug: string,
            @Body() body: ChangeSubscriberBusinessStatusDto,
            @Req() request: unknown,
        ): Promise<AdminSubscriberCorrected> {
            return this.rlsBypass.runWithBypass(async () => {
                const { tenantId, subscriberId } = await this.subscriberAt(slug);
                const { change } = await this.subscribers.changeBusinessStatus(subscriberId, {
                    business: body.business,
                    reason: body.reason,
                    changedBy: this.audit.actorTagFromRequest(request),
                });
                if (change) {
                    await this.audit.logFromRequest(
                        request,
                        'Subscriber',
                        subscriberId,
                        'SUBSCRIBER_BUSINESS_STATUS_CHANGED',
                        { tenantId, business: body.business, reason: change.reason },
                    );
                }
                return { subscriber: await this.standing.ofTenant(tenantId), vatIdCheck: null };
            });
        }

        /**
         * Checks the VAT number the tenant's subscriber holds, without changing
         * it, and records the check. No second factor: nobody enters anything,
         * and the answer is the service's.
         */
        @Post('tenants/:slug/subscriber/vat-id-check')
        @HttpCode(200)
        checkVatId(
            @Param('slug') slug: string,
            @Req() request: unknown,
        ): Promise<AdminSubscriberCorrected> {
            return this.rlsBypass.runWithBypass(async () => {
                const { tenantId, subscriberId } = await this.subscriberAt(slug);
                const result = await this.subscribers.checkVatIdOf({ subscriberId });
                await this.audit.logFromRequest(
                    request,
                    'Subscriber',
                    subscriberId,
                    'SUBSCRIBER_VAT_ID_CHECKED',
                    {
                        tenantId,
                        completed: result.completed,
                        ...(result.completed ? { valid: result.check.valid } : {}),
                    },
                );
                return {
                    subscriber: await this.standing.ofTenant(tenantId),
                    vatIdCheck: vatIdCheckOutcomeOf(result),
                };
            });
        }

        /** Which tenants of the list hold their subscriber back from its next contract, and why. */
        @Get('subscribers/attention')
        attention(
            @Query() query: SubscriberAttentionQueryDto,
        ): Promise<{ attention: AdminSubscriberAttention[] }> {
            // The list the pipe built — or, where the application's
            // `ValidationPipe` does not transform, the query as sent: one id as
            // a string, none at all.
            const sent: string | string[] | undefined = query.tenantId;
            const tenantIds = sent === undefined ? [] : Array.isArray(sent) ? sent : [sent];
            return this.rlsBypass.runWithBypass(async () => ({
                attention: await this.standing.attentionAmong(tenantIds),
            }));
        }

        /** The tenant and its subscriber, refused as the reads refuse them. */
        private async subscriberAt(
            slug: string,
        ): Promise<{ tenantId: string; subscriberId: string }> {
            const tenant = await this.tenants.getTenantDetail(slug);
            const subscriber = await this.subscribers.requireForTenant(tenant.id);
            return { tenantId: tenant.id, subscriberId: subscriber.id };
        }
    }

    return GeneratedSubscriberAdminController;
}

/**
 * The operator's routes about a tenant's subscriber, served beside the tenant
 * it belongs to: its tax details and what holds its next contract back
 * (`SC-PRIC-070`), its history, and the corrections of its legal identity and
 * business status and the check of its VAT number.
 */
@Module({})
export class SubscriberAdminModule {
    static forRoot(options: SubscriberAdminModuleOptions): DynamicModule {
        return {
            module: SubscriberAdminModule,
            imports: options.imports,
            providers: [
                asProvider(SUBSCRIBER_REPOSITORY_TOKEN, options.subscriberRepository),
                SubscriberStandingService,
                SubscriberService,
                WebAuditLogger,
            ],
            controllers: [buildSubscriberAdminController(options.guards)],
        };
    }
}
