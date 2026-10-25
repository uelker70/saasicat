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
    SUBSCRIBER_SEARCH_MAX_LENGTH,
    type AdminSubscriberAttention,
    type AdminSubscriberCorrected,
    type AdminSubscriberHistoryEntry,
    type AdminSubscriberList,
    type AdminSubscriberRecord,
    type AdminSubscriberStanding,
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
import { SubscriberRecordService } from './subscriber-record.service.js';
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

/** The longest subscriber id a page of the list is continued after. */
const MAX_ID_LENGTH = 200;

/** `GET admin/subscribers?q=…&withoutLiveTenant=true&after=…` — one page of the list. */
export class SubscriberListQueryDto {
    @IsOptional()
    @IsString()
    @MaxLength(SUBSCRIBER_SEARCH_MAX_LENGTH)
    q?: string;

    @IsOptional()
    @IsIn(['true', 'false', true, false])
    withoutLiveTenant?: 'true' | 'false' | boolean;

    @IsOptional()
    @IsString()
    @MaxLength(MAX_ID_LENGTH)
    after?: string;
}

/**
 * `POST admin/subscribers/:id/identity` — a correction of the legal
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

/** `POST admin/subscribers/:id/business-status` — whether it acts as a business, and why. */
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
            @Inject(SubscriberRecordService)
            private readonly records: SubscriberRecordService,
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

        /** The tenant's subscriber and what holds its next contract back; the rest is in its record. */
        @Get('tenants/:slug/subscriber')
        subscriberOf(@Param('slug') slug: string): Promise<AdminTenantSubscriber> {
            return this.rlsBypass.runWithBypass(async () => {
                const tenant = await this.tenants.getTenantDetail(slug);
                return this.standing.ofTenant(tenant.id);
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

        /**
         * One page of the subscribers, the latest customer number first:
         * every one, those a customer number, legal name or VAT number
         * matches, and those whose every tenant link is closed.
         */
        @Get('subscribers')
        list(@Query() query: SubscriberListQueryDto): Promise<AdminSubscriberList> {
            return this.rlsBypass.runWithBypass(() =>
                this.records.list({
                    query: query.q,
                    // A query string carries text: only `true` asks for those without a tenant.
                    withoutLiveTenant: String(query.withoutLiveTenant) === 'true',
                    after: query.after,
                }),
            );
        }

        /** The head of the subscriber's record: its standing and every tenant it was linked to. */
        @Get('subscribers/:id')
        recordOf(@Param('id') id: string): Promise<AdminSubscriberRecord> {
            return this.rlsBypass.runWithBypass(() => this.records.recordOf(id));
        }

        /** Every correction, change of country or business status, and check, the latest first. */
        @Get('subscribers/:id/history')
        historyOf(@Param('id') id: string): Promise<{ entries: AdminSubscriberHistoryEntry[] }> {
            return this.rlsBypass.runWithBypass(async () => {
                const subscriber = await this.subscribers.requireById(id);
                return { entries: await this.standing.historyOf(subscriber.id) };
            });
        }

        /**
         * Corrects the subscriber's legal identity, with the second factor. A
         * VAT number it gives the subscriber is checked right after, where a
         * tax adapter decides, and the outcome is answered — the correction
         * stands whatever the check found. The audit entry is written between
         * the two, so a check that fails cannot leave a correction nobody
         * recorded.
         */
        @Post('subscribers/:id/identity')
        @HttpCode(200)
        @EnforceMfa()
        correctIdentity(
            @Param('id') id: string,
            @Body() body: CorrectSubscriberIdentityDto,
            @Req() request: unknown,
        ): Promise<AdminSubscriberCorrected> {
            return this.rlsBypass.runWithBypass(async () => {
                const subscriber = await this.subscribers.requireById(id);
                const correction = await this.subscribers.correctIdentity(subscriber.id, {
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
                    subscriber.id,
                    'SUBSCRIBER_IDENTITY_CORRECTED',
                    {
                        tenantId: subscriber.tenantId,
                        fields: Object.keys(correction.corrected),
                        reason: correction.reason,
                    },
                );
                const vatIdCheck = await this.subscribers.checkCorrectedVatId(correction);
                return {
                    subscriber: await this.standingNow(subscriber.id),
                    vatIdCheck: vatIdCheck && vatIdCheckOutcomeOf(vatIdCheck),
                };
            });
        }

        /** Records whether the subscriber acts as a business, and why, with the second factor. */
        @Post('subscribers/:id/business-status')
        @HttpCode(200)
        @EnforceMfa()
        changeBusinessStatus(
            @Param('id') id: string,
            @Body() body: ChangeSubscriberBusinessStatusDto,
            @Req() request: unknown,
        ): Promise<AdminSubscriberCorrected> {
            return this.rlsBypass.runWithBypass(async () => {
                const subscriber = await this.subscribers.requireById(id);
                const { change } = await this.subscribers.changeBusinessStatus(subscriber.id, {
                    business: body.business,
                    reason: body.reason,
                    changedBy: this.audit.actorTagFromRequest(request),
                });
                if (change) {
                    await this.audit.logFromRequest(
                        request,
                        'Subscriber',
                        subscriber.id,
                        'SUBSCRIBER_BUSINESS_STATUS_CHANGED',
                        {
                            tenantId: subscriber.tenantId,
                            business: body.business,
                            reason: change.reason,
                        },
                    );
                }
                return { subscriber: await this.standingNow(subscriber.id), vatIdCheck: null };
            });
        }

        /**
         * Checks the VAT number the subscriber holds, without changing it, and
         * records the check. No second factor: nobody enters anything, and the
         * answer is the service's.
         */
        @Post('subscribers/:id/vat-id-check')
        @HttpCode(200)
        checkVatId(
            @Param('id') id: string,
            @Req() request: unknown,
        ): Promise<AdminSubscriberCorrected> {
            return this.rlsBypass.runWithBypass(async () => {
                const subscriber = await this.subscribers.requireById(id);
                const result = await this.subscribers.checkVatIdOf({ subscriberId: subscriber.id });
                await this.audit.logFromRequest(
                    request,
                    'Subscriber',
                    subscriber.id,
                    'SUBSCRIBER_VAT_ID_CHECKED',
                    {
                        tenantId: subscriber.tenantId,
                        completed: result.completed,
                        ...(result.completed ? { valid: result.check.valid } : {}),
                    },
                );
                return {
                    subscriber: await this.standingNow(subscriber.id),
                    vatIdCheck: vatIdCheckOutcomeOf(result),
                };
            });
        }

        /** The subscriber as it stands after a write, read again. */
        private async standingNow(subscriberId: string): Promise<AdminSubscriberStanding> {
            return this.standing.standingOf(await this.subscribers.requireById(subscriberId));
        }
    }

    return GeneratedSubscriberAdminController;
}

/**
 * The operator's routes about subscribers: a tenant's subscriber beside the
 * tenant and what holds its next contract back (`SC-PRIC-070`); the list of
 * subscribers and the head of each one's record, whether its tenant lives or
 * not (`SC-ADM-036`); its history, and the corrections of its legal identity
 * and business status and the check of its VAT number.
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
                SubscriberRecordService,
                SubscriberService,
                WebAuditLogger,
            ],
            controllers: [buildSubscriberAdminController(options.guards)],
        };
    }
}
