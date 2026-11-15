// Canonical rows <-> record mapping for the deletion of a tenant. Pure, and
// shared by both adapters for the reason `subscription-contract-mapping.ts`
// gives: the record outlives the tenant, so both read it back alike and refuse
// alike what nobody can read.

import { oneOf } from './closed-value.js';
import { dayOf } from './column-day.js';
import type {
    CommercialRecordCounts,
    TenantCount,
    TenantDeletionFailure,
    TenantDeletionRecord,
    TenantDeletionRecordHalt,
    TenantDeletionStep,
    TenantDeletionStore,
    TenantKeepLine,
} from './tenant-deletion.types.js';

const TABLE = 'subscriber_tenant_deletions';
const COUNTS_TABLE = 'subscriber_tenant_deletion_counts';

const HALTS: readonly TenantDeletionRecordHalt[] = [
    'tenant-id-invalid',
    'no-subscriber',
    'commercial-record-lost',
];
const STEPS: readonly TenantDeletionStep[] = ['count', 'erase', 'guard', 'close'];
const COMMERCIAL_PARTS: readonly (keyof CommercialRecordCounts)[] = [
    'subscriber',
    'contracts',
    'charges',
    'invoices',
    'payments',
    'credits',
];

/** What a count row is: what a store erased, or what the tenant keeps itself. */
export type TenantDeletionCountKind = 'erased' | 'kept';

/** A `subscriber_tenant_deletion_stores` row as either adapter reads it back. */
export interface CanonicalTenantDeletionStoreRow {
    store: string;
    position: number;
    countedAt: Date | null;
    erasedAt: Date | null;
}

/** A `subscriber_tenant_deletion_counts` row as either adapter reads it back, its labels unread. */
export interface CanonicalTenantDeletionCountRow {
    kind: string;
    store: string | null;
    category: string;
    count: number;
    labels: unknown;
}

/**
 * A `subscriber_tenant_deletions` row with its stores and counts, as either
 * adapter reads it back: `deletesOn` is a `Date` from Prisma and text from
 * Drizzle, and the JSON columns hold whatever was written to them.
 */
export interface CanonicalTenantDeletionRow {
    id: string;
    tenantId: string;
    subscriberId: string;
    subscriptionId: string;
    subscriptionEndId: string;
    deletesOn: unknown;
    exportOfferedFrom: Date;
    exportBlockedBySuspension: boolean;
    commercialBefore: unknown;
    commercialAfter: unknown;
    startedAt: Date;
    claimedAt: Date | null;
    attempts: number;
    lastFailure: unknown;
    halt: string | null;
    closedAt: Date | null;
    stores: readonly CanonicalTenantDeletionStoreRow[];
    counts: readonly CanonicalTenantDeletionCountRow[];
}

/** A count row to write, without the ids the adapter assigns. */
export interface TenantDeletionCountColumns {
    kind: TenantDeletionCountKind;
    store: string | null;
    category: string;
    count: number;
    labels: Record<string, string> | null;
}

/** The `lastFailure` column as written: the moment as ISO text, which JSON keeps. */
export interface TenantDeletionFailureColumn {
    step: TenantDeletionStep;
    store: string | null;
    code: string;
    at: string;
}

/** The count rows of what the tenant keeps itself: no store, and its words. */
export function keptCountColumns(keep: readonly TenantKeepLine[]): TenantDeletionCountColumns[] {
    return keep.map((line) => ({
        kind: 'kept',
        store: null,
        category: line.category,
        count: line.count,
        labels: { ...line.labels },
    }));
}

/** The count rows of what `store` held for the tenant before it erased. */
export function erasedCountColumns(
    store: string,
    counts: readonly TenantCount[],
): TenantDeletionCountColumns[] {
    return counts.map((line) => ({
        kind: 'erased',
        store,
        category: line.category,
        count: line.count,
        labels: null,
    }));
}

/** `failure` as the `lastFailure` column keeps it. */
export function tenantDeletionFailureColumn(
    failure: TenantDeletionFailure,
): TenantDeletionFailureColumn {
    return {
        step: failure.step,
        store: failure.store,
        code: failure.code,
        at: failure.at.toISOString(),
    };
}

/**
 * Reads a row with its stores and counts back as a record, naming each column
 * rather than spreading the row. The stores come in their order, and the kept
 * lines and each store's counts by category, compared character by character
 * so no database's collation decides it. A value the platform does not write
 * stops at the read and names its row.
 */
export function toTenantDeletionRecord(row: CanonicalTenantDeletionRow): TenantDeletionRecord {
    const where = (column: string) => ({ table: TABLE, column, id: row.id });
    const counts = row.counts.map((count) => ({
        ...count,
        kind: oneOf<TenantDeletionCountKind>(['erased', 'kept'], count.kind, {
            table: COUNTS_TABLE,
            column: 'kind',
            id: row.id,
        }),
    }));
    return {
        id: row.id,
        tenantId: row.tenantId,
        subscriberId: row.subscriberId,
        subscriptionId: row.subscriptionId,
        subscriptionEndId: row.subscriptionEndId,
        deletesOn: dayOf(row.deletesOn, where('deletesOn')),
        exportOfferedFrom: row.exportOfferedFrom,
        exportBlockedBySuspension: row.exportBlockedBySuspension,
        keep: counts
            .filter((count) => count.kind === 'kept')
            .map((count) => ({
                category: count.category,
                count: count.count,
                labels: labelsOf(count.labels, row.id),
            }))
            .sort(byCategory),
        commercialBefore: commercialOf(row.commercialBefore, where('commercialBefore')),
        commercialAfter: commercialOf(row.commercialAfter, where('commercialAfter')),
        startedAt: row.startedAt,
        claimedAt: row.claimedAt,
        attempts: row.attempts,
        lastFailure: failureOf(row.lastFailure, where('lastFailure')),
        halt: row.halt === null ? null : oneOf(HALTS, row.halt, where('halt')),
        closedAt: row.closedAt,
        stores: [...row.stores]
            .sort((a, b) => a.position - b.position)
            .map((store): TenantDeletionStore => ({
                store: store.store,
                position: store.position,
                countedAt: store.countedAt,
                counts: counts
                    .filter((count) => count.kind === 'erased' && count.store === store.store)
                    .map((count) => ({ category: count.category, count: count.count }))
                    .sort(byCategory),
                erasedAt: store.erasedAt,
            })),
    };
}

/** By category, compared as strings are in JavaScript: code unit by code unit. */
function byCategory(a: { category: string }, b: { category: string }): number {
    if (a.category === b.category) return 0;
    return a.category < b.category ? -1 : 1;
}

/** A member of `value`, unread; undefined where `value` is no object or lacks it. */
function memberOf(value: object, key: string): unknown {
    return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function isObject(value: unknown): value is object {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A kept line's words: an object of texts, English among them. */
function labelsOf(value: unknown, id: string): TenantKeepLine['labels'] {
    const entries = isObject(value) ? Object.entries(value) : [];
    const labels: Record<string, string> = {};
    for (const [locale, label] of entries) {
        if (typeof label === 'string') labels[locale] = label;
    }
    const en = labels.en;
    if (en === undefined || Object.keys(labels).length !== entries.length) {
        throw new Error(
            `${COUNTS_TABLE} of deletion '${id}' holds labels of a kept category that are not ` +
                'texts by locale with an English one.',
        );
    }
    return { ...labels, en };
}

function isCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** The commercial record counted, or null where it was not; anything else is refused. */
function commercialOf(
    value: unknown,
    where: { table: string; column: string; id: string },
): CommercialRecordCounts | null {
    if (value === null || value === undefined) return null;
    if (!isObject(value) || !COMMERCIAL_PARTS.every((part) => isCount(memberOf(value, part)))) {
        throw new Error(
            `${where.table} row '${where.id}' holds ${where.column} that is not a count of ` +
                `each of ${COMMERCIAL_PARTS.join(', ')}.`,
        );
    }
    const counted = (part: keyof CommercialRecordCounts): number => {
        const count = memberOf(value, part);
        return isCount(count) ? count : 0;
    };
    return {
        subscriber: counted('subscriber'),
        contracts: counted('contracts'),
        charges: counted('charges'),
        invoices: counted('invoices'),
        payments: counted('payments'),
        credits: counted('credits'),
    };
}

/** The last failure, or null where there was none; anything else is refused. */
function failureOf(
    value: unknown,
    where: { table: string; column: string; id: string },
): TenantDeletionFailure | null {
    if (value === null || value === undefined) return null;
    const refused = () =>
        new Error(
            `${where.table} row '${where.id}' holds ${where.column} that is not a step, a store, ` +
                'a code and a moment.',
        );
    if (!isObject(value)) throw refused();
    const step = memberOf(value, 'step');
    const store = memberOf(value, 'store');
    const code = memberOf(value, 'code');
    const at = memberOf(value, 'at');
    const moment = typeof at === 'string' ? new Date(at) : null;
    if (
        typeof step !== 'string' ||
        (store !== null && typeof store !== 'string') ||
        typeof code !== 'string' ||
        moment === null ||
        Number.isNaN(moment.getTime())
    ) {
        throw refused();
    }
    return {
        step: oneOf(STEPS, step, where),
        store,
        code,
        at: moment,
    };
}
