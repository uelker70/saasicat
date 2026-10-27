// The contract register of the installation: every contract, a former
// subscriber's and a deleted tenant's included (`SC-ADM-045`), the latest
// start first, narrowed to where the contracts stand on a day — today, or one
// the operator picks.

import type { AdminContractSource } from './contract-confirmation.types.js';
import type { SubscriptionContractRecord } from './subscription-contract.types.js';
import type { CalendarDay } from './zoned-day.js';

/** How many contracts one page of the register holds. */
export const CONTRACT_REGISTER_PAGE_SIZE = 50;

/**
 * Where a contract stands on a day of the installation: in force on it, ended
 * before it, starting after it, or never in force at all — superseded before it
 * began, as a scheduled change is when another change replaces it first.
 */
export const CONTRACT_STANDINGS = ['in-force', 'ended', 'scheduled', 'never-in-force'] as const;
export type ContractStanding = (typeof CONTRACT_STANDINGS)[number];

/** What the register is narrowed to: the contracts of one standing, or all of them. */
export const CONTRACT_REGISTER_STATES = [...CONTRACT_STANDINGS, 'all'] as const;
export type ContractRegisterState = (typeof CONTRACT_REGISTER_STATES)[number];

/**
 * The moments a store narrows the register to. What each standing means is
 * decided in `contractRegisterWindowOf`; a store compares a contract's
 * `effectiveFrom` and `effectiveUntil` with the moments given and decides
 * nothing of its own. A contract never in force is one whose `effectiveUntil`
 * is not after its `effectiveFrom`, and no window but `never-in-force` and
 * `all` holds one.
 */
export type ContractRegisterWindow =
    | { kind: 'all' }
    | { kind: 'never-in-force' }
    /** In force at some moment from `from` to before `until`. */
    | { kind: 'overlapping'; from: Date; until: Date }
    /** Ended at or before `by`. */
    | { kind: 'ended-by'; by: Date }
    /** Starting at or after `from`. */
    | { kind: 'starting-from'; from: Date };

/** One page of the register as a store reads it, the latest start first. */
export interface ContractRegisterRecordPage {
    contracts: SubscriptionContractRecord[];
    hasMore: boolean;
}

/** One contract as the operator reads it in the register. */
export interface AdminRegisterContract {
    id: string;
    /** The subscriber as its record names it now, and the record it leads to. */
    subscriber: { id: string; customerNumber: string; legalName: string };
    /**
     * The tenant it was concluded for. `known` is `false` where the application
     * no longer has it; `deletedAt` is set where it soft-deleted it.
     */
    tenant: {
        id: string;
        known: boolean;
        name: string | null;
        slug: string | null;
        deletedAt: string | null;
    };
    /** The plan it was concluded on, as frozen; `null` for a contract without a plan line. */
    plan: AdminContractSource | null;
    /** The add-ons it carries, as frozen. */
    bundles: AdminContractSource[];
    /** The first day it is in force, in the installation's time zone. */
    firstDay: CalendarDay;
    /** The last day it is in force there; `null` while it runs open-ended, and for one never in force. */
    lastDay: CalendarDay | null;
    /** Where it stands on the day the register was read on, in the installation's time zone. */
    standing: ContractStanding;
    billingCycle: 'monthly' | 'yearly';
    currency: string;
    /** What it costs per billing period, tax included. */
    totalGross: number;
}

/** One page of the register as the operator reads it. */
export interface AdminContractRegisterPage {
    /** Today in the installation's time zone. */
    today: CalendarDay;
    state: ContractRegisterState;
    /** The day every standing is read on: today, unless another was asked for. */
    day: CalendarDay;
    contracts: AdminRegisterContract[];
    /** The contract the next page continues after; `null` on the last page. */
    next: string | null;
}
