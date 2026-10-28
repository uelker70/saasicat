import {
    Body,
    type CanActivate,
    Controller,
    HttpCode,
    Inject,
    Param,
    Post,
    Req,
    type Type,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import {
    SUBSCRIBER_REASON_MAX_LENGTH,
    type AdminSubscriberJoined,
    type AdminSubscriberJoinPreview,
    type RlsBypassPort,
} from '@saasicat/core';

import { RLS_BYPASS_PORT_TOKEN } from '../admin/admin.tokens.js';
import { EnforceMfa } from '../admin/enforce-mfa.decorator.js';
import { UseRouteGuards } from '../admin/use-route-guards.decorator.js';
import { WebAuditLogger } from '../core/web-audit.js';
import { AllowDuringMaintenance } from '../maintenance/allow-during-maintenance.js';
import { SUBSCRIBER_ID_MAX_LENGTH } from './subscriber-limits.js';
import { SubscriberJoinService } from './subscriber-join.service.js';
import { SubscriberRecordService } from './subscriber-record.service.js';
import { SubscriberService } from './subscriber.service.js';

/** A SHA-256 digest as the preview gives it. */
const DIGEST = /^[0-9a-f]{64}$/;

/**
 * `POST admin/subscribers/:id/join/preview` — what joining the subscriber with
 * the live tenant (`:id`) into the earlier one would do.
 */
export class PreviewSubscriberJoinDto {
    @IsString()
    @MaxLength(SUBSCRIBER_ID_MAX_LENGTH)
    intoSubscriberId!: string;
}

/**
 * `POST admin/subscribers/:id/join` — the join itself. `kind` is the operator's
 * declaration: `same-entity` for one legal entity; another one taking over is
 * a transfer, and refused. `previewDigest` holds the join to what was shown.
 */
export class JoinSubscriberDto extends PreviewSubscriberJoinDto {
    @IsIn(['same-entity', 'takeover'])
    kind!: 'same-entity' | 'takeover';

    @IsString()
    @MaxLength(SUBSCRIBER_REASON_MAX_LENGTH)
    reason!: string;

    @IsOptional()
    @Matches(DIGEST)
    previewDigest?: string;
}

/**
 * The operator's routes that join a returning customer's subscriber into the
 * one it had (`SC-ADM-027`), behind the same chain as the subscriber's other
 * routes. Only composed where the installation keeps joins.
 */
export function buildSubscriberJoinController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin')
    @AllowDuringMaintenance()
    @UseRouteGuards(...guards)
    class GeneratedSubscriberJoinController {
        constructor(
            @Inject(SubscriberJoinService)
            private readonly joins: SubscriberJoinService,
            @Inject(SubscriberRecordService)
            private readonly records: SubscriberRecordService,
            @Inject(SubscriberService)
            private readonly subscribers: SubscriberService,
            @Inject(WebAuditLogger)
            private readonly audit: WebAuditLogger,
            @Inject(RLS_BYPASS_PORT_TOKEN)
            private readonly rlsBypass: RlsBypassPort,
        ) {}

        /** Both subscribers side by side, what moves, and the digest the join is held to. */
        @Post('subscribers/:id/join/preview')
        @HttpCode(200)
        preview(
            @Param('id') id: string,
            @Body() body: PreviewSubscriberJoinDto,
        ): Promise<AdminSubscriberJoinPreview> {
            return this.rlsBypass.runWithBypass(async () => {
                await this.bothExist(id, body.intoSubscriberId);
                return this.records.previewOf(await this.joins.preview(id, body.intoSubscriberId));
            });
        }

        /**
         * Joins them, with the second factor. The audit entry is written once
         * the join stands: the join's own record is written with it, in its
         * transaction, so a failed entry here leaves nothing unrecorded.
         */
        @Post('subscribers/:id/join')
        @HttpCode(200)
        @EnforceMfa()
        join(
            @Param('id') id: string,
            @Body() body: JoinSubscriberDto,
            @Req() request: unknown,
        ): Promise<AdminSubscriberJoined> {
            return this.rlsBypass.runWithBypass(async () => {
                await this.bothExist(id, body.intoSubscriberId);
                const outcome = await this.joins.join(
                    id,
                    body.intoSubscriberId,
                    { kind: body.kind, reason: body.reason, previewDigest: body.previewDigest },
                    this.audit.actorTagFromRequest(request),
                    (decision) => this.records.previewOf(decision),
                );
                await this.audit.logFromRequest(
                    request,
                    'Subscriber',
                    outcome.join.intoSubscriberId,
                    'SUBSCRIBER_JOINED',
                    {
                        fromSubscriberId: outcome.join.fromSubscriberId,
                        intoSubscriberId: outcome.join.intoSubscriberId,
                        reason: outcome.join.reason,
                        moved: outcome.join.moved,
                    },
                );
                return { joinedInto: await this.records.joinedIntoOf(outcome.join) };
            });
        }

        /** Refused, naming the one that is not there, where either subscriber is not. */
        private async bothExist(fromSubscriberId: string, intoSubscriberId: string): Promise<void> {
            await this.subscribers.requireById(fromSubscriberId);
            await this.subscribers.requireById(intoSubscriberId);
        }
    }

    return GeneratedSubscriberJoinController;
}
