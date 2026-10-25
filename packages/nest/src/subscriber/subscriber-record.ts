// How the operator's list and a subscriber's record name the tenants a
// subscriber is linked to: by what the application answers for each id now.
//
// The platform keeps a tenant's id on the link and nothing else, because the
// tenant is the application's. So a tenant the application no longer has is
// shown as such — with its id, and without a name — and its link is not read
// as ended: only a closed link ends one (`SC-ADM-036`).

import type {
    AdminSubscriberRow,
    AdminSubscriberTenant,
    AdminTenantSummary,
    SubscriberRecord,
    SubscriberTenantLinkRecord,
} from '@saasicat/core';

/** Each link as the record lists it, in the order the store gave them. */
export function subscriberTenantsOf(
    links: readonly SubscriberTenantLinkRecord[],
    known: readonly AdminTenantSummary[],
): AdminSubscriberTenant[] {
    const byId = new Map(known.map((tenant) => [tenant.id, tenant]));
    return links.map((link) => {
        const tenant = byId.get(link.tenantId);
        return {
            tenantId: link.tenantId,
            linkedAt: link.linkedAt.toISOString(),
            unlinkedAt: link.unlinkedAt?.toISOString() ?? null,
            known: tenant !== undefined,
            slug: tenant?.slug ?? null,
            name: tenant?.name ?? null,
            deletedAt: tenant?.deletedAt ?? null,
        };
    });
}

/** One subscriber as the list shows it, its live tenant named where the application knows it. */
export function subscriberRowOf(
    subscriber: SubscriberRecord,
    known: readonly AdminTenantSummary[],
): AdminSubscriberRow {
    const tenantId = subscriber.tenantId;
    const tenant =
        tenantId === null ? undefined : known.find((candidate) => candidate.id === tenantId);
    return {
        id: subscriber.id,
        customerNumber: subscriber.customerNumber,
        legalName: subscriber.legalName,
        vatId: subscriber.vatId,
        city: subscriber.city,
        country: subscriber.country,
        liveTenant:
            tenantId === null
                ? null
                : { id: tenantId, slug: tenant?.slug ?? null, name: tenant?.name ?? null },
    };
}
