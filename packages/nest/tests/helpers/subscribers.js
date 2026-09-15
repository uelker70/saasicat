// The party a contract is concluded with, for tests whose subject is something
// else. Every way a contract arises refuses a tenant without a subscriber, so a
// test about prices, windows or offers gives its tenants one here and moves on.

import { SubscriberService } from '../../dist/subscriber/index.js';
import { FakeSubscriberRepository } from '../../dist/testing/index.js';

/** The catalogue a subscriber service reads its prefix and the issuer from. */
export const SUBSCRIBER_CATALOG = {
    schemaVersion: 1,
    app: { name: 'Test App' },
    currency: 'EUR',
    vatRate: 19,
    plans: [],
};

/**
 * A `SubscriberService` over an in-memory repository, with a subscriber for
 * each tenant named — `Customer of <tenantId>`, and nothing else known.
 */
export async function subscribersFor(tenantIds = [], catalog = SUBSCRIBER_CATALOG) {
    const repository = new FakeSubscriberRepository();
    const service = new SubscriberService(repository, catalog);
    for (const tenantId of tenantIds) {
        await service.createForTenant(tenantId, { legalName: `Customer of ${tenantId}` });
    }
    return { repository, service };
}
