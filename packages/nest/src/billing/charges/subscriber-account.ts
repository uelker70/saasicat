import type {
    AdminAccountEntry,
    AdminSubscriberAccount,
    SubscriberCharge,
    SubscriberChargeRecord,
    SubscriberChargeSource,
    SubscriberRecord,
    SubscriptionContractRecord,
} from '@saasicat/core';

/** Within one period, the order an invoice lists its lines in. */
const SOURCE_ORDER: Record<SubscriberChargeSource, number> = { plan: 0, bundle: 1, discount: 2 };

export interface AccountViewInput {
    subscriber: SubscriberRecord | null;
    charges: readonly SubscriberChargeRecord[];
    /** The tenant's contracts, superseded ones included: a charge names the line it came from. */
    contracts: readonly SubscriptionContractRecord[];
}

function toWire(charge: SubscriberChargeRecord): SubscriberCharge {
    return {
        ...charge,
        periodStart: charge.periodStart.toISOString(),
        periodEnd: charge.periodEnd.toISOString(),
        bookedAt: charge.bookedAt.toISOString(),
        createdAt: charge.createdAt.toISOString(),
    };
}

function newestFirst(a: SubscriberChargeRecord, b: SubscriberChargeRecord): number {
    return (
        b.bookedAt.getTime() - a.bookedAt.getTime() ||
        b.periodStart.getTime() - a.periodStart.getTime() ||
        SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] ||
        a.id.localeCompare(b.id)
    );
}

/** The account the operator reads: each charge with its line's title, newest first. */
export function accountViewOf(input: AccountViewInput): AdminSubscriberAccount {
    const titles = new Map<string, string>();
    for (const contract of input.contracts) {
        for (const line of contract.lineItems) titles.set(line.id, line.titleSnapshot);
    }
    const entries: AdminAccountEntry[] = [...input.charges].sort(newestFirst).map((charge) => ({
        charge: toWire(charge),
        title: titles.get(charge.contractLineItemId) ?? null,
    }));
    const subscriber = input.subscriber;
    return {
        holder: subscriber
            ? {
                  id: subscriber.id,
                  customerNumber: subscriber.customerNumber,
                  legalName: subscriber.legalName,
              }
            : null,
        entries,
    };
}
