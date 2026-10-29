// What a join decides, from what it read under its locks (`SC-ADM-027`).
// Framework-free and without I/O: the service reads the state, this decides,
// and a repository writes what was decided.

import { SUBSCRIBER_ERROR_CODES, type PlatformErrorCode } from './error-codes.js';
import type {
    SubscriberIdentityValues,
    SubscriberRecord,
    SubscriberTaxOriginValues,
} from './subscriber.types.js';
import { taxOriginWrite } from './tax-origin.js';
import { identityCorrectionDelta } from './subscriber-mapping.js';
import {
    SUBSCRIBER_OWNED_TABLES,
    type SubscriberJoinPlan,
    type SubscriberJoinReplacement,
    type SubscriberJoinRequest,
    type SubscriberJoinSide,
    type SubscriberJoinState,
    type SubscriberOwnedTable,
} from './subscriber-join.types.js';

/** The address a subscriber's invoices name: it replaces as a whole, never field by field. */
const ADDRESS_FIELDS = ['addressLine1', 'addressLine2', 'postalCode', 'city', 'country'] as const;

/**
 * The tables a schema holds that name a subscriber: every one but those of a
 * model `notAdopted` leaves out, in the order a join moves them. The names are
 * the ones the persistence bundle was given, which it checked.
 */
export function subscriberTablesOf(notAdopted: readonly string[] = []): SubscriberOwnedTable[] {
    return SUBSCRIBER_OWNED_TABLES.filter((owned) => !notAdopted.includes(owned.model)).map(
        (owned) => owned.table,
    );
}

/** The trigger `1.0-a-subscriber-is-joined.postgres.sql` guards `table` with. */
export function subscriberJoinGuardOf(table: SubscriberOwnedTable): string {
    return `${table}_names_no_joined_subscriber`;
}

/**
 * The trigger that keeps the row of a joined subscriber as the join left it:
 * a change that read the subscriber before the join and writes after it
 * would otherwise land on the record nobody reads, not the one it was joined
 * into.
 */
export const SUBSCRIBER_JOIN_ROW_GUARD = {
    table: 'subscribers',
    trigger: 'subscribers_change_nothing_once_joined',
} as const;

/** A trigger of `1.0-a-subscriber-is-joined.postgres.sql`, by the table it is on. */
export interface SubscriberJoinGuard {
    table: string;
    trigger: string;
}

/**
 * Every trigger that guards a join where the schema holds `tables`: the one on
 * `subscribers` and one on each table that names a subscriber.
 */
export function subscriberJoinGuardsOf(
    tables: readonly SubscriberOwnedTable[],
): SubscriberJoinGuard[] {
    return [
        SUBSCRIBER_JOIN_ROW_GUARD,
        ...tables.map((table) => ({ table, trigger: subscriberJoinGuardOf(table) })),
    ];
}

/**
 * Why a join could leave something for the subscriber it joined behind, given
 * the enabled triggers of each table `subscriberJoinGuardsOf` names, or `null`
 * where each has its guard. A write that read a subscriber before the join and
 * writes after it would otherwise land at an empty record nobody looks at.
 */
export function subscriberJoinProtectionProblem(
    tables: readonly SubscriberOwnedTable[],
    enabledTriggersOf: (table: string) => readonly string[],
): string | null {
    const unguarded = subscriberJoinGuardsOf(tables)
        .filter(({ table, trigger }) => !enabledTriggersOf(table).includes(trigger))
        .map(({ table }) => table);
    if (unguarded.length === 0) return null;
    return (
        `${unguarded.join(', ')} ` +
        (unguarded.length === 1
            ? 'lacks its trigger, which refuses'
            : 'lack their triggers, which refuse') +
        ' a row for a joined subscriber or a change of one: run ' +
        '@saasicat/spec/sql/1.0-a-subscriber-is-joined.postgres.sql after db push, and enable the ' +
        'triggers where they were disabled.'
    );
}

/** The table a join records itself in, and the model it holds. */
export const SUBSCRIBER_JOIN_TABLE = {
    table: 'subscriber_joins',
    model: 'SubscriberJoin',
} as const;

/**
 * Why a join cannot run on this schema — a table it reads or moves, its own
 * among them, that the client or the database lacks — or `null` where it has
 * every one. A table a join cannot reach would keep its rows at the subscriber
 * joined, so the platform does not start joining rather than leave them there.
 */
export function subscriberJoinSchemaProblem(missing: readonly string[]): string | null {
    if (missing.length === 0) return null;
    const named = [SUBSCRIBER_JOIN_TABLE, ...SUBSCRIBER_OWNED_TABLES]
        .filter((owned) => missing.includes(owned.table))
        .map((owned) => `${owned.model} (${owned.table})`);
    return (
        `The schema lacks ${named.join(', ')}, which a join of subscribers reads or moves rows in: ` +
        'adopt each and run db push, or name it in notAdopted. A schema that leaves out ' +
        'SubscriberJoin offers no join.'
    );
}

/** A join refused, with its code and the values a screen names it by. */
export interface SubscriberJoinRefusal {
    code: PlatformErrorCode;
    params: Record<string, string>;
}

const liveLinkOf = (side: SubscriberJoinSide) =>
    side.links.find((link) => link.unlinkedAt === null);

/**
 * Why this join cannot be made, or `null` where it can. Asked in a fixed
 * order — what the operator gave, then what the subscribers are — and the
 * first that holds is the answer. Without a request only the subscribers are
 * asked about: a preview is shown before a reason is given.
 */
export function subscriberJoinRefusal(
    state: SubscriberJoinState,
    request?: Pick<SubscriberJoinRequest, 'kind' | 'reason'>,
): SubscriberJoinRefusal | null {
    const { from, into } = state;
    const refused = (
        code: SubscriberJoinRefusal['code'],
        params: Record<string, string> = {},
    ): SubscriberJoinRefusal => ({ code, params });
    if (request && request.reason.trim() === '') {
        return refused(SUBSCRIBER_ERROR_CODES.SUBSCRIBER_JOIN_REASON_REQUIRED);
    }
    if (request && request.kind !== 'same-entity') {
        return refused(SUBSCRIBER_ERROR_CODES.SUBSCRIBER_TAKEOVER_IS_A_TRANSFER);
    }
    if (from.subscriber.id === into.subscriber.id) {
        return refused(SUBSCRIBER_ERROR_CODES.SUBSCRIBER_JOIN_SAME_SUBSCRIBER);
    }
    for (const side of [from, into]) {
        if (side.joinedIntoId !== null) {
            return refused(SUBSCRIBER_ERROR_CODES.SUBSCRIBER_JOIN_ALREADY_JOINED, {
                customerNumber: side.subscriber.customerNumber,
            });
        }
    }
    if (!liveLinkOf(from)) {
        return refused(SUBSCRIBER_ERROR_CODES.SUBSCRIBER_JOIN_WITHOUT_LIVE_TENANT, {
            customerNumber: from.subscriber.customerNumber,
        });
    }
    const intoLive = liveLinkOf(into);
    if (intoLive) {
        return refused(SUBSCRIBER_ERROR_CODES.SUBSCRIBER_JOIN_INTO_HAS_LIVE_TENANT, {
            customerNumber: into.subscriber.customerNumber,
            tenantId: intoLive.tenantId,
        });
    }
    return null;
}

/**
 * What joining `state.from` into `state.into` changes. What the subscriber
 * joined holds is newer: sign-up collected it from the customer just now. So
 * its address replaces the earlier one as a whole where it has one, and its
 * invoice email, business status and legal identity each where it has a value
 * — an empty one says nothing and is not written over a known one. A legal
 * identity that differs is a correction of the same entity, and a tax origin
 * that moves is one change, both with the join's reason. The check that counts
 * for the subscriber joined counts for the number taken over. Every payment
 * method in use at the earlier subscriber goes out of use: the one entered at
 * sign-up is the one the customer gave for now.
 *
 * Asks nothing of `subscriberJoinRefusal`: call that first.
 */
export function planSubscriberJoin(state: SubscriberJoinState): SubscriberJoinPlan {
    const from = state.from.subscriber;
    const into = state.into.subscriber;
    const contact: SubscriberJoinPlan['contact'] = {};
    const replaced: SubscriberJoinReplacement[] = [];
    const replace = (field: SubscriberJoinReplacement['field'], next: string | boolean | null) => {
        const previous = into[field];
        if (previous === next) return;
        replaced.push({ field, previous, next });
    };
    if (from.addressLine1 !== null) {
        for (const field of ADDRESS_FIELDS) {
            if (into[field] === from[field]) continue;
            contact[field] = from[field];
            replace(field, from[field]);
        }
    }
    if (from.invoiceEmail !== null && from.invoiceEmail !== into.invoiceEmail) {
        contact.invoiceEmail = from.invoiceEmail;
        replace('invoiceEmail', from.invoiceEmail);
    }
    const business =
        from.business !== null && from.business !== into.business ? from.business : undefined;
    if (business !== undefined) replace('business', business);

    const delta = identityCorrectionDelta(into, valuesGiven(from));
    const identity = Object.keys(delta.corrected).length > 0 ? delta : null;
    const vatId = identity?.corrected.vatId !== undefined ? identity.corrected.vatId : into.vatId;

    const originNext: SubscriberTaxOriginValues = {};
    if (contact.country !== undefined) originNext.country = contact.country;
    if (business !== undefined) originNext.business = business;
    if (vatId !== into.vatId) originNext.vatId = vatId;
    const origin = taxOriginWrite(into, originNext);

    const fromCheck = state.from.countingVatIdCheck;
    const intoCheck = state.into.countingVatIdCheck;
    const adopts =
        fromCheck !== null &&
        fromCheck.vatId === vatId &&
        (vatId !== into.vatId ||
            intoCheck === null ||
            intoCheck.checkedAt.getTime() < fromCheck.checkedAt.getTime());

    return {
        fromSubscriberId: from.id,
        intoSubscriberId: into.id,
        moving: state.moving,
        contact,
        business,
        replaced,
        identity,
        taxOrigin: origin.moved ? { previous: origin.previous, changed: origin.changed } : null,
        vatIdCheck: adopts ? 'adopted' : vatId !== into.vatId ? 'ended' : 'kept',
        adoptedVatIdCheckId: adopts ? fromCheck.id : null,
        // Every one, also where the subscriber joined brings none: a mandate
        // given for the earlier contracts is not charged for the new ones
        // without being given again, and the tenant gives one in its billing
        // area.
        paymentMethodsOutOfUse: state.into.paymentMethodsInUse,
    };
}

/** The identity fields the subscriber joined has a value for. */
function valuesGiven(from: SubscriberRecord): SubscriberIdentityValues {
    const given: SubscriberIdentityValues = { legalName: from.legalName };
    if (from.vatId !== null) given.vatId = from.vatId;
    if (from.taxNumber !== null) given.taxNumber = from.taxNumber;
    return given;
}

/**
 * What a join's digest is taken over: everything the decision depends on and
 * the preview shows, in a fixed shape, dates as ISO text. The same state gives
 * the same input; a write to either subscriber, a link, a check, a payment
 * method or one more row to move changes it.
 */
export function subscriberJoinDigestInput(state: SubscriberJoinState): unknown {
    const side = (each: SubscriberJoinSide) => ({
        subscriber: {
            ...each.subscriber,
            createdAt: null,
            updatedAt: each.subscriber.updatedAt.toISOString(),
        },
        links: each.links.map((link) => ({
            tenantId: link.tenantId,
            linkedAt: link.linkedAt.toISOString(),
            unlinkedAt: link.unlinkedAt?.toISOString() ?? null,
        })),
        joinedIntoId: each.joinedIntoId,
        countingVatIdCheckId: each.countingVatIdCheck?.id ?? null,
        paymentMethodsInUse: each.paymentMethodsInUse,
    });
    return { from: side(state.from), into: side(state.into), moving: state.moving };
}
