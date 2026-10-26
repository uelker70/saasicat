// A subscriber's contracts as its record's timeline reads them: one timeline
// per tenant, each contract with the parts of what it changed against the one
// before it, and the contracts in force on a day the operator picks
// (`SC-ADM-041`).
//
// The changes are the server's, read from the contracts as they were frozen;
// this only arranges them. Framework-free, so the grouping and the day's
// marking are checked with `node --test` against `dist/`.

import type {
    AdminContractChange,
    AdminContractLine,
    AdminSubscriberContract,
    AdminSubscriberTenant,
    CalendarDay,
} from '@saasicat/core';

/** One tenant's contracts. */
export interface ContractTimeline {
    tenantId: string;
    /** The tenant as the record names it; `null` where the record names no link to it. */
    tenant: AdminSubscriberTenant | null;
    /** Its contracts, the latest start first. */
    contracts: AdminSubscriberContract[];
}

/** A part of what a contract changed, as one phrase names it. */
export type ContractChangeKind =
    | 'concluded'
    | 'planUpgraded'
    | 'planDowngraded'
    | 'planChanged'
    | 'bundleAdded'
    | 'bundleRemoved'
    | 'frozenAnew'
    | 'frozenAnewAtNewPrice'
    | 'cancelled';

export interface ContractChangePart {
    kind: ContractChangeKind;
    /** The add-on it names, for an add-on added or removed; otherwise `null`. */
    title: string | null;
}

const PLAN_CHANGE_KIND: Readonly<
    Record<'upgraded' | 'downgraded' | 'changed', ContractChangeKind>
> = {
    upgraded: 'planUpgraded',
    downgraded: 'planDowngraded',
    changed: 'planChanged',
};

/**
 * The contracts grouped by the tenant each was concluded for, the tenants in
 * the order the record names them — the live one first — and a tenant the
 * record does not name after them.
 */
export function contractTimelinesOf(
    contracts: readonly AdminSubscriberContract[],
    tenants: readonly AdminSubscriberTenant[],
): ContractTimeline[] {
    const position = new Map(tenants.map((tenant, index) => [tenant.tenantId, index]));
    const byTenant = new Map<string, AdminSubscriberContract[]>();
    for (const contract of contracts) {
        const chain = byTenant.get(contract.tenantId) ?? [];
        chain.push(contract);
        byTenant.set(contract.tenantId, chain);
    }
    return [...byTenant.entries()]
        .map(([tenantId, chain]) => ({
            tenantId,
            tenant: tenants.find((tenant) => tenant.tenantId === tenantId) ?? null,
            contracts: [...chain].sort(latestStartFirst),
        }))
        .sort(
            (a, b) =>
                (position.get(a.tenantId) ?? tenants.length) -
                    (position.get(b.tenantId) ?? tenants.length) ||
                a.tenantId.localeCompare(b.tenantId),
        );
}

/**
 * Whether the contract was in force on `day`, a calendar day in the
 * installation's zone — the one its own days are read in. Both its first and
 * its last day count; one never in force is in force on none.
 */
export function inForceOn(contract: AdminSubscriberContract, day: CalendarDay): boolean {
    if (contract.neverInForce) return false;
    return contract.firstDay <= day && (contract.lastDay === null || day <= contract.lastDay);
}

/** What a contract changed, as the phrases the timeline says it in, in that order. */
export function contractChangePartsOf(change: AdminContractChange): ContractChangePart[] {
    const parts: ContractChangePart[] = [];
    if (change.concluded) parts.push({ kind: 'concluded', title: null });
    if (change.plan) parts.push({ kind: PLAN_CHANGE_KIND[change.plan], title: null });
    for (const bundle of change.bundlesAdded)
        parts.push({ kind: 'bundleAdded', title: bundle.title });
    for (const bundle of change.bundlesRemoved) {
        parts.push({ kind: 'bundleRemoved', title: bundle.title });
    }
    if (change.frozenAnew) {
        parts.push({
            kind: change.priceChanged ? 'frozenAnewAtNewPrice' : 'frozenAnew',
            title: null,
        });
    }
    if (change.cancelled) parts.push({ kind: 'cancelled', title: null });
    return parts;
}

/**
 * The plan and add-on lines with a feature or a quota whose key holds `text`,
 * in any case — every line where `text` is blank. A discount carries neither,
 * so it is shown only while nothing is filtered.
 */
export function contractLinesMatching(
    lines: readonly AdminContractLine[],
    text: string,
): AdminContractLine[] {
    const wanted = text.trim().toLowerCase();
    if (wanted === '') return [...lines];
    const holds = (key: string) => key.toLowerCase().includes(wanted);
    return lines.filter(
        (line) => line.features.some(holds) || Object.keys(line.quotas).some(holds),
    );
}

function latestStartFirst(a: AdminSubscriberContract, b: AdminSubscriberContract): number {
    return (
        b.effectiveFrom.localeCompare(a.effectiveFrom) ||
        b.concludedAt.localeCompare(a.concludedAt) ||
        b.id.localeCompare(a.id)
    );
}
