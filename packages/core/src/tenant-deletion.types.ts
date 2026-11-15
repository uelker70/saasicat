// The deletion of a tenant whose subscription ended (`SC-PRIV-022`).
//
// On the day its end names, the platform has the application erase the
// tenant's data and files, store by store, through the erasers it lists
// (`TenantEraser`), and keeps a record of the deletion with the subscriber
// (`SC-PRIV-023`): what each store counted before it erased, when each
// confirmed, what the tenant was told to keep itself, and the subscriber's own
// commercial record counted before the first store and after each — which no
// store may take with it (`SC-PRIV-011`). The record names no person; the rows
// the platform keeps of the tenant beyond the deletion keep the role somebody
// acted in instead (`actorRoleOf`).
//
// Everything an application answers is checked here before it is kept: the
// record outlives the tenant, and a value nobody can read stops the run rather
// than reaching the record as something it is not.

import type { CalendarDay } from './zoned-day.js';

/** The longest store name or category a deletion keeps. */
export const TENANT_DELETION_KEY_MAX_LENGTH = 64;

// One quantifier on one class, asked only of text within the length above, so
// no input can be split across it in more than one way.
const TENANT_DELETION_KEY_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Whether `value` names a store or a category: lower-case letters, digits and
 * dashes, beginning with a letter, at most `TENANT_DELETION_KEY_MAX_LENGTH`
 * long. A record keeps counts under these keys for years, so they are stable
 * keys, not words: the words for a category are its labels.
 */
export function isTenantDeletionKey(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        value.length <= TENANT_DELETION_KEY_MAX_LENGTH &&
        TENANT_DELETION_KEY_PATTERN.test(value)
    );
}

/** One category of what a store holds for a tenant, and how many. */
export interface TenantCount {
    /** The application's stable key for the category (`isTenantDeletionKey`). */
    readonly category: string;
    readonly count: number;
}

/** A line of what the tenant has to keep for obligations of its own (`SC-PRIV-022`). */
export interface TenantKeepLine {
    /** The application's stable key for the category (`isTenantDeletionKey`). */
    readonly category: string;
    readonly count: number;
    /**
     * The category in the application's words, by locale. `en` is required and
     * is what a reader in a locale the labels do not name is shown.
     */
    readonly labels: Readonly<{ en: string } & Record<string, string>>;
}

/** The longest tenant identifier an eraser is given. */
export const TENANT_ID_MAX_LENGTH = 200;

/** What is wrong with a value given as the one tenant to erase. */
export type TenantIdProblem =
    'missing' | 'not-a-string' | 'blank' | 'surrounding-space' | 'too-long';

/**
 * What is wrong with `value` as the identifier of the one tenant to erase, or
 * `null` where it names one (`SC-PRIV-016`). Nothing is trimmed: an identifier
 * with a space around it is not the tenant without the space.
 */
export function tenantIdProblem(value: unknown): TenantIdProblem | null {
    if (value === undefined || value === null) return 'missing';
    if (typeof value !== 'string') return 'not-a-string';
    if (value.trim() === '') return 'blank';
    if (value.trim() !== value) return 'surrounding-space';
    if (value.length > TENANT_ID_MAX_LENGTH) return 'too-long';
    return null;
}

/**
 * Refuses to erase anything for a value that does not name exactly one
 * tenant. The message names the problem and never the value, which may be
 * anything and is written to a log.
 */
export class TenantIdRefused extends Error {
    constructor(readonly problem: TenantIdProblem) {
        super(
            `Refused to erase a tenant: the tenant identifier given is ${problem}. ` +
                'An eraser is called with exactly one tenant (SC-PRIV-016).',
        );
        this.name = 'TenantIdRefused';
    }
}

/**
 * The first line of every eraser (`SC-PRIV-016`): throws `TenantIdRefused`
 * unless `value` names exactly one tenant. An empty or missing identifier in
 * a query that filters by it reaches every tenant at once. The platform checks
 * the identifier before each call as well; this is the check the
 * application's own code makes, which the platform cannot make for it.
 */
export function assertOneTenant(value: unknown): asserts value is string {
    const problem = tenantIdProblem(value);
    if (problem !== null) throw new TenantIdRefused(problem);
}

/** What is wrong with the counts or the lines an application answered with. */
export type TenantCountProblem = 'not-a-list' | 'category' | 'count' | 'duplicate-category';

/** A record is read by people adding counts up, so a count is exact or refused. */
function isCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** What a line an application answered with holds, each part as it came. */
function partsOf(line: unknown): { category: unknown; count: unknown; labels: unknown } {
    if (typeof line !== 'object' || line === null) {
        return { category: undefined, count: undefined, labels: undefined };
    }
    return {
        category: 'category' in line ? line.category : undefined,
        count: 'count' in line ? line.count : undefined,
        labels: 'labels' in line ? line.labels : undefined,
    };
}

type LineParts = ReturnType<typeof partsOf>;

/**
 * Holds each entry of a list to a category and a count, each category once,
 * and then to what `rest` asks of it.
 */
function countedLinesProblem<Problem>(
    value: unknown,
    rest: (line: LineParts) => Problem | null,
): TenantCountProblem | Problem | null {
    if (!Array.isArray(value)) return 'not-a-list';
    const seen = new Set<string>();
    for (const line of value) {
        const parts = partsOf(line);
        const { category } = parts;
        if (!isTenantDeletionKey(category)) return 'category';
        if (!isCount(parts.count)) return 'count';
        if (seen.has(category)) return 'duplicate-category';
        seen.add(category);
        const problem = rest(parts);
        if (problem !== null) return problem;
    }
    return null;
}

/** Whether `value` is a label: text with something in it. */
function isLabel(value: unknown): boolean {
    return typeof value === 'string' && value.trim() !== '';
}

/** Whether `value` is a line's labels: an object of labels, `en` among them. */
function areLabels(value: unknown): boolean {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    return 'en' in value && isLabel(value.en) && Object.values(value).every(isLabel);
}

/**
 * What is wrong with the counts a store answered `count` with, or `null`
 * where they are a list of `TenantCount`, each category once.
 */
export function tenantCountsProblem(value: unknown): TenantCountProblem | null {
    return countedLinesProblem(value, () => null);
}

/**
 * What is wrong with the lines a `TenantKeepReportPort` answered with, or
 * `null` where they are a list of `TenantKeepLine`: held to what counts are
 * held to, and each worded in English at least.
 */
export function keepLinesProblem(value: unknown): TenantCountProblem | 'labels' | null {
    return countedLinesProblem(value, ({ labels }) => (areLabels(labels) ? null : 'labels'));
}

/** The role a person acted in, which a row keeps once its tenant is deleted (`SC-PRIV-023`). */
export type DeletionActorRole = 'tenant-admin' | 'operator' | 'run';

/**
 * A column that names who acted, in a row the platform keeps of a tenant
 * beyond its deletion. It decides the role of a `web:` tag, which does not say
 * whether the operator or the tenant's administrator signed in.
 */
export type ActorColumn =
    | 'hold.recordedBy.suspended'
    | 'hold.recordedBy.other'
    | 'hold.liftedBy'
    | 'end.recordedBy'
    | 'announcement.announcedBy'
    | 'download.downloadedBy';

/**
 * The role a `web:` tag in each column acted in. Only the operator suspends a
 * tenant or lifts a reason from the web; the other reasons are recorded by
 * runs; ending a subscription, being told its day and taking the export happen
 * on the tenant's routes, where an operator acting as the tenant acts in the
 * tenant administrator's role.
 */
const ROLE_OF_COLUMN: Readonly<Record<ActorColumn, DeletionActorRole>> = {
    'hold.recordedBy.suspended': 'operator',
    'hold.recordedBy.other': 'run',
    'hold.liftedBy': 'operator',
    'end.recordedBy': 'tenant-admin',
    'announcement.announcedBy': 'tenant-admin',
    'download.downloadedBy': 'tenant-admin',
};

/**
 * The role the actor tagged `tag` acted in, read in `column`. A platform job
 * (`job:`) is the run and the command line (`cli:`) the operator, wherever
 * they wrote; every other tag — `web:`, or one of no known kind — is the role
 * of its column. The tag itself is never the answer: it may name a person.
 */
export function actorRoleOf(tag: string, column: ActorColumn): DeletionActorRole {
    if (tag.startsWith('job:')) return 'run';
    if (tag.startsWith('cli:')) return 'operator';
    return ROLE_OF_COLUMN[column];
}

/** The subscriber's commercial record, counted: what outlives the tenant (`SC-PRIV-011`). */
export interface CommercialRecordCounts {
    readonly subscriber: number;
    readonly contracts: number;
    /** Charges on the ledger, invoiced or not yet: a charge not invoiced is still owed. */
    readonly charges: number;
    readonly invoices: number;
    readonly payments: number;
    readonly credits: number;
}

const COMMERCIAL_RECORD_FIELDS: readonly (keyof CommercialRecordCounts)[] = [
    'subscriber',
    'contracts',
    'charges',
    'invoices',
    'payments',
    'credits',
];

/**
 * The parts of the commercial record that fell between `before` and `after`;
 * empty where nothing was lost. A part that grew lost nothing: the invoicing
 * run may issue an invoice while a deletion erases.
 */
export function commercialRecordLost(
    before: CommercialRecordCounts,
    after: CommercialRecordCounts,
): (keyof CommercialRecordCounts)[] {
    return COMMERCIAL_RECORD_FIELDS.filter((field) => after[field] < before[field]);
}

/**
 * Why a due deletion does not go on. The installation's two are decided anew
 * by every run from its mark (`SC-PRIV-021`) and never kept; the others are
 * kept with the record, which has nowhere to be kept for `tenant-id-invalid`
 * and `no-subscriber` either, so those two are only said.
 */
export type TenantDeletionHalt =
    | 'installation-unmarked'
    | 'installation-differs'
    | 'tenant-id-invalid'
    | 'no-subscriber'
    | 'commercial-record-lost';

/** A halt a deletion record keeps. */
export type TenantDeletionRecordHalt = Exclude<
    TenantDeletionHalt,
    'installation-unmarked' | 'installation-differs'
>;

/** The step of a deletion a failure stopped it at. */
export type TenantDeletionStep = 'count' | 'erase' | 'guard' | 'close';

/** The last failure a deletion met; the next run goes on from where it stopped. */
export interface TenantDeletionFailure {
    readonly step: TenantDeletionStep;
    /** The store it failed at, where it failed at one. */
    readonly store: string | null;
    /**
     * A code, never a message: the error's own `code`, or its name. An
     * application's message may carry anything, a person included, and the
     * record outlives the tenant.
     */
    readonly code: string;
    readonly at: Date;
}

/** One store's part in a deletion: what it counted and when, and when it confirmed. */
export interface TenantDeletionStore {
    readonly store: string;
    /** Its place in the order the stores are erased in, from 0. */
    readonly position: number;
    readonly countedAt: Date | null;
    readonly counts: readonly TenantCount[];
    readonly erasedAt: Date | null;
}

/** The deletion of one tenant, kept with its subscriber (`SC-PRIV-023`). It names no person. */
export interface TenantDeletionRecord {
    readonly id: string;
    readonly tenantId: string;
    readonly subscriberId: string;
    readonly subscriptionId: string;
    readonly subscriptionEndId: string;
    /** The installation's day the end named for the deletion. */
    readonly deletesOn: CalendarDay;
    /** When the export was first offered: when the end was recorded (`SC-PRIV-024`). */
    readonly exportOfferedFrom: Date;
    /**
     * Whether a suspension held at some moment between the end and the
     * beginning of the deletion, keeping the export from being taken then
     * (`SC-PRIV-024`).
     */
    readonly exportBlockedBySuspension: boolean;
    /** What the tenant was told to keep itself, as the deletion began. */
    readonly keep: readonly TenantKeepLine[];
    /** The subscriber's commercial record before the first store erased. */
    readonly commercialBefore: CommercialRecordCounts | null;
    /** The subscriber's commercial record as the deletion closed. */
    readonly commercialAfter: CommercialRecordCounts | null;
    readonly startedAt: Date;
    /** When the run that holds it took it on; null where none holds it. */
    readonly claimedAt: Date | null;
    /** How many times a run failed at it. */
    readonly attempts: number;
    readonly lastFailure: TenantDeletionFailure | null;
    /** Why it does not go on until somebody acts; null while it may. */
    readonly halt: TenantDeletionRecordHalt | null;
    /** When every store had confirmed and the record was closed; null until then. */
    readonly closedAt: Date | null;
    /** The stores in the order they are erased in. */
    readonly stores: readonly TenantDeletionStore[];
}

/** A deletion to begin: the id is the store's to assign. */
export type NewTenantDeletionRecord = Pick<
    TenantDeletionRecord,
    | 'tenantId'
    | 'subscriberId'
    | 'subscriptionId'
    | 'subscriptionEndId'
    | 'deletesOn'
    | 'exportOfferedFrom'
    | 'exportBlockedBySuspension'
    | 'keep'
    | 'startedAt'
> & {
    readonly stores: readonly { readonly store: string; readonly position: number }[];
};
