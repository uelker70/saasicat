import { Inject, Injectable, Optional } from '@nestjs/common';
import {
    SUBSCRIBER_LIST_PAGE_SIZE,
    subscriberSearchTermsOf,
    type AdminSubscriberJoinNote,
    type AdminSubscriberJoinPreview,
    type AdminSubscriberJoinSide,
    type AdminSubscriberJoins,
    type AdminSubscriberList,
    type AdminSubscriberRecord,
    type SubscriberJoinRecord,
    type SubscriberJoinSide,
    type SubscriberRepository,
} from '@saasicat/core';

import { AdminResourcesService } from '../admin/admin-resources.module.js';
import { subscriberRowOf, subscriberTenantsOf } from './subscriber-record.js';
import { SubscriberJoinService, type SubscriberJoinDecision } from './subscriber-join.service.js';
import { SubscriberStandingService } from './subscriber-standing.service.js';
import { SubscriberService } from './subscriber.service.js';
import { SUBSCRIBER_REPOSITORY_TOKEN } from './subscriber.tokens.js';

/** What the operator's list of subscribers is asked for. */
export interface SubscriberListRequest {
    /** A customer number, a legal name or a VAT number; blank for every subscriber. */
    query?: string;
    withoutLiveTenant?: boolean;
    /** The subscriber the page before ended with. */
    after?: string;
}

/**
 * The operator's way to a subscriber that does not go through its tenant: the
 * list, searched by what a caller gives, and the head of each subscriber's
 * record with every tenant it was linked to (`SC-ADM-021`, `SC-ADM-036`). It
 * reads only.
 */
@Injectable()
export class SubscriberRecordService {
    constructor(
        @Inject(SUBSCRIBER_REPOSITORY_TOKEN)
        private readonly repo: SubscriberRepository,
        @Inject(SubscriberStandingService)
        private readonly standing: SubscriberStandingService,
        @Inject(SubscriberService)
        private readonly subscribers: SubscriberService,
        @Inject(AdminResourcesService)
        private readonly tenants: AdminResourcesService,
        // Where the installation keeps joins; without it the record names none.
        @Optional()
        @Inject(SubscriberJoinService)
        private readonly joins: SubscriberJoinService | null = null,
    ) {}

    /** One page of the subscribers the request matches, the latest customer number first. */
    async list(request: SubscriberListRequest): Promise<AdminSubscriberList> {
        const page = await this.repo.search({
            terms: subscriberSearchTermsOf(request.query ?? ''),
            withoutLiveTenant: request.withoutLiveTenant === true,
            limit: SUBSCRIBER_LIST_PAGE_SIZE,
            after: request.after,
        });
        const liveTenantIds = page.subscribers.flatMap(({ tenantId }) =>
            tenantId === null ? [] : [tenantId],
        );
        const known = await this.tenants.findTenantsByIds(liveTenantIds);
        const rows = page.subscribers.map((subscriber) => subscriberRowOf(subscriber, known));
        const subscribers = this.joins ? await this.markedJoined(rows) : rows;
        return {
            subscribers,
            next: page.hasMore ? (subscribers.at(-1)?.id ?? null) : null,
        };
    }

    /** The subscriber's standing and every tenant it was linked to; refused where there is no such subscriber. */
    async recordOf(subscriberId: string): Promise<AdminSubscriberRecord> {
        const subscriber = await this.subscribers.requireById(subscriberId);
        const [standing, links] = await Promise.all([
            this.standing.standingOf(subscriber),
            this.repo.listTenantLinks(subscriberId),
        ]);
        const known = await this.tenants.findTenantsByIds(links.map((link) => link.tenantId));
        const record: AdminSubscriberRecord = {
            ...standing,
            tenants: subscriberTenantsOf(links, known),
        };
        if (this.joins) record.joins = await this.joinsOf(subscriberId, this.joins);
        return record;
    }

    /**
     * What a join would do, as the operator is shown it: both subscribers as
     * their records name them, side by side, what moves, what is replaced and
     * corrected, and the digest the join names to be held to it.
     */
    async previewOf(decision: SubscriberJoinDecision): Promise<AdminSubscriberJoinPreview> {
        const { plan } = decision;
        return {
            from: await this.sideOf(decision.state.from),
            into: await this.sideOf(decision.state.into),
            moving: plan.moving,
            replaced: plan.replaced,
            corrected: plan.identity,
            vatIdCheck: plan.vatIdCheck,
            paymentMethodsOutOfUse: plan.paymentMethodsOutOfUse,
            paymentMethodsTakenOver: decision.state.from.paymentMethodsInUse,
            digest: decision.digest,
        };
    }

    /** A join as the record of the subscriber joined names it: the one everything moved to. */
    async joinedIntoOf(join: SubscriberJoinRecord): Promise<AdminSubscriberJoinNote> {
        const [into] = await this.repo.findByIds([join.intoSubscriberId]);
        return noteOf(join, join.intoSubscriberId, into);
    }

    private async sideOf(side: SubscriberJoinSide): Promise<AdminSubscriberJoinSide> {
        const standing = await this.standing.standingOf(side.subscriber);
        const known = await this.tenants.findTenantsByIds(side.links.map((link) => link.tenantId));
        return { subscriber: standing.subscriber, tenants: subscriberTenantsOf(side.links, known) };
    }

    /** The subscriber it was joined into, and those joined into it, the latest first. */
    private async joinsOf(
        subscriberId: string,
        joins: SubscriberJoinService,
    ): Promise<AdminSubscriberJoins> {
        const recorded = await joins.joinsOf([subscriberId]);
        const otherOf = (join: SubscriberJoinRecord) =>
            join.fromSubscriberId === subscriberId ? join.intoSubscriberId : join.fromSubscriberId;
        const others = await this.repo.findByIds(recorded.map(otherOf));
        const note = (join: SubscriberJoinRecord) =>
            noteOf(
                join,
                otherOf(join),
                others.find((other) => other.id === otherOf(join)),
            );
        const into = recorded.find((join) => join.fromSubscriberId === subscriberId);
        return {
            into: into ? note(into) : null,
            from: recorded
                .filter((join) => join.intoSubscriberId === subscriberId)
                .sort((a, b) => b.joinedAt.getTime() - a.joinedAt.getTime())
                .map(note),
        };
    }

    /** The rows of a page, each marked with the subscriber it was joined into, where it was. */
    private async markedJoined(
        rows: AdminSubscriberList['subscribers'],
    ): Promise<AdminSubscriberList['subscribers']> {
        if (!this.joins || rows.length === 0) return rows;
        const joined = (await this.joins.joinsOf(rows.map((row) => row.id))).filter((join) =>
            rows.some((row) => row.id === join.fromSubscriberId),
        );
        const into = await this.repo.findByIds(joined.map((join) => join.intoSubscriberId));
        return rows.map((row) => {
            const join = joined.find((each) => each.fromSubscriberId === row.id);
            const other = join && into.find((each) => each.id === join.intoSubscriberId);
            return {
                ...row,
                joinedInto: join
                    ? {
                          subscriberId: join.intoSubscriberId,
                          customerNumber: other?.customerNumber ?? join.intoSubscriberId,
                      }
                    : null,
            };
        });
    }
}

/** A join as a record names the other subscriber of it. */
function noteOf(
    join: SubscriberJoinRecord,
    otherId: string,
    other: { customerNumber: string; legalName: string } | undefined,
): AdminSubscriberJoinNote {
    return {
        subscriberId: otherId,
        customerNumber: other?.customerNumber ?? otherId,
        legalName: other?.legalName ?? '',
        joinedAt: join.joinedAt.toISOString(),
        joinedBy: join.joinedBy,
        reason: join.reason,
    };
}
