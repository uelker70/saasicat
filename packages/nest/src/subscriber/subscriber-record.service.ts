import { Inject, Injectable } from '@nestjs/common';
import {
    SUBSCRIBER_LIST_PAGE_SIZE,
    subscriberSearchTermsOf,
    type AdminSubscriberList,
    type AdminSubscriberRecord,
    type SubscriberRepository,
} from '@saasicat/core';

import { AdminResourcesService } from '../admin/admin-resources.module.js';
import { subscriberRowOf, subscriberTenantsOf } from './subscriber-record.js';
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
        const subscribers = page.subscribers.map((subscriber) =>
            subscriberRowOf(subscriber, known),
        );
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
        return { ...standing, tenants: subscriberTenantsOf(links, known) };
    }
}
