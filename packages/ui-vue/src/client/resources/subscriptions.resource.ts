// The subscription list.
//
// One operation and no filter, because that is the endpoint: the controller
// takes no query and answers every subscription it can see. `SubscriptionsPage`
// filters and sorts the rows it was given, in the browser.

import type { AdminSubscriptionListRow } from '@saasicat/core';

import { defineResource, type ResourceContext } from './define-resource.js';
import { requestJson } from './resource-request.js';

function subscriptionsUrl(ctx: ResourceContext): string {
    return `${ctx.apiBase}/subscriptions`;
}

export const subscriptionsResource = defineResource('subscriptions', {
    list: async (http, ctx): Promise<AdminSubscriptionListRow[]> =>
        (await requestJson<AdminSubscriptionListRow[]>(http, subscriptionsUrl(ctx))) ?? [],
});
