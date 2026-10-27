// Where a contract stands on a day of the installation, and the moments a
// store narrows the contract register to for each standing (`SC-ADM-045`).
//
// One rule for both: a store lists a contract under a standing exactly when
// `contractStandingOn` gives it that standing on the day asked about, and the
// persistence contract checks that after every scenario. A day is the moments
// from its first to the next day's first, in the installation's zone, so a
// contract that ends at ten in the morning and its successor that begins then
// are both in force on that day.

import { contractDaysOf, contractSourcesOf, neverInForce } from './contract-dossier.js';
import type {
    AdminRegisterContract,
    ContractRegisterState,
    ContractRegisterWindow,
    ContractStanding,
} from './contract-register.types.js';
import type { AdminTenantSummary } from './ports/admin-ports.types.js';
import type { SubscriptionContractRecord } from './subscription-contract.types.js';
import { addDaysToDay, startOfDayInZone, type CalendarDay } from './zoned-day.js';

type ContractWindow = Pick<SubscriptionContractRecord, 'effectiveFrom' | 'effectiveUntil'>;

/** The first moment of `day` and of the day after it, in `timeZone`. */
function boundsOf(day: CalendarDay, timeZone: string): { from: Date; until: Date } {
    return {
        from: startOfDayInZone(day, timeZone),
        until: startOfDayInZone(addDaysToDay(day, 1), timeZone),
    };
}

/** Where `contract` stands on `day` in `timeZone`. */
export function contractStandingOn(
    contract: ContractWindow,
    day: CalendarDay,
    timeZone: string,
): ContractStanding {
    if (neverInForce(contract)) return 'never-in-force';
    const { from, until } = boundsOf(day, timeZone);
    if (contract.effectiveFrom.getTime() >= until.getTime()) return 'scheduled';
    if (contract.effectiveUntil && contract.effectiveUntil.getTime() <= from.getTime()) {
        return 'ended';
    }
    return 'in-force';
}

/** The window each state narrows the register to, given the bounds of the day asked about. */
const WINDOWS: Readonly<
    Record<ContractRegisterState, (bounds: { from: Date; until: Date }) => ContractRegisterWindow>
> = {
    all: () => ({ kind: 'all' }),
    'never-in-force': () => ({ kind: 'never-in-force' }),
    'in-force': ({ from, until }) => ({ kind: 'overlapping', from, until }),
    ended: ({ from }) => ({ kind: 'ended-by', by: from }),
    scheduled: ({ until }) => ({ kind: 'starting-from', from: until }),
};

/** The moments a store narrows the register to, for the contracts of `state` on `day`. */
export function contractRegisterWindowOf(
    state: ContractRegisterState,
    day: CalendarDay,
    timeZone: string,
): ContractRegisterWindow {
    return WINDOWS[state](boundsOf(day, timeZone));
}

/**
 * Whether `window` holds `contract`: the comparison a store makes, written out
 * for a store that keeps its contracts in memory.
 */
export function contractInsideWindow(
    contract: ContractWindow,
    window: ContractRegisterWindow,
): boolean {
    const never = neverInForce(contract);
    const from = contract.effectiveFrom.getTime();
    const until = contract.effectiveUntil?.getTime() ?? null;
    switch (window.kind) {
        case 'all':
            return true;
        case 'never-in-force':
            return never;
        case 'overlapping':
            return (
                !never &&
                from < window.until.getTime() &&
                (until === null || until > window.from.getTime())
            );
        case 'ended-by':
            return !never && until !== null && until <= window.by.getTime();
        case 'starting-from':
            return !never && from >= window.from.getTime();
    }
}

/**
 * One contract as the register lists it: its subscriber as the record names it
 * now, its tenant as the application still knows it or not, and where it
 * stands on `day`.
 */
export function adminRegisterContractOf(
    contract: SubscriptionContractRecord,
    subscriber: { id: string; customerNumber: string; legalName: string },
    tenant: AdminTenantSummary | undefined,
    day: CalendarDay,
    timeZone: string,
): AdminRegisterContract {
    const { firstDay, lastDay } = contractDaysOf(contract, timeZone);
    return {
        id: contract.id,
        subscriber: {
            id: subscriber.id,
            customerNumber: subscriber.customerNumber,
            legalName: subscriber.legalName,
        },
        tenant: {
            id: contract.tenantId,
            known: tenant !== undefined,
            name: tenant?.name ?? null,
            slug: tenant?.slug ?? null,
            deletedAt: tenant?.deletedAt ?? null,
        },
        ...contractSourcesOf(contract),
        firstDay,
        lastDay,
        standing: contractStandingOn(contract, day, timeZone),
        billingCycle: contract.priceSnapshot.billingCycle,
        currency: contract.priceSnapshot.currency,
        totalGross: contract.priceSnapshot.totalGross,
    };
}
