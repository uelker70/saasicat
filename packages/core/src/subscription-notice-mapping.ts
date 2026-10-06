// Canonical row -> record mapping for subscriber notices. Pure, and shared by
// both adapters for the reason `subscription-contract-mapping.ts` gives.

import { oneOf } from './closed-value.js';
import type {
    SubscriptionNoticeDelivery,
    SubscriptionNoticeKind,
    SubscriptionNoticeRecord,
} from './subscription-notice.types.js';

const TABLE = 'subscription_notices';

// Keyed rather than listed, so that a kind added to the type fails to compile
// here until it is read as well.
const KINDS: Record<SubscriptionNoticeKind, true> = {
    'version-offered': true,
    'version-retired': true,
    'version-retirement-reminder': true,
    'bundle-version-retired': true,
    'bundle-version-retirement-reminder': true,
    'bundle-version-offered': true,
};

/**
 * A `subscription_notices` row as either adapter reads it back. The two JSON
 * columns are `unknown`: the database holds whatever was written to them.
 */
export interface CanonicalSubscriptionNoticeRow {
    id: string;
    tenantId: string;
    subscriptionId: string;
    kind: string;
    subject: string;
    content: unknown;
    createdAt: Date;
    claimedAt: Date | null;
    deliveredAt: Date | null;
    recipients: unknown;
    channel: string | null;
}

/**
 * Reads a row back as a record, naming each column rather than spreading the
 * row. The kind and the delivery are checked rather than cast: the record is
 * what a subscriber is later shown they were told, and a value nobody can read
 * must stop at the read and name its row.
 */
export function toSubscriptionNoticeRecord(
    row: CanonicalSubscriptionNoticeRow,
): SubscriptionNoticeRecord {
    return {
        id: row.id,
        tenantId: row.tenantId,
        subscriptionId: row.subscriptionId,
        kind: oneOf(Object.keys(KINDS) as SubscriptionNoticeKind[], row.kind, {
            table: TABLE,
            column: 'kind',
            id: row.id,
        }),
        subject: row.subject,
        content: row.content,
        createdAt: row.createdAt,
        claimedAt: row.claimedAt,
        deliveredAt: row.deliveredAt,
        delivery: row.deliveredAt === null ? null : deliveryOf(row),
    };
}

/** Who a delivered notice went to and how; set in one write with `deliveredAt`. */
function deliveryOf(row: CanonicalSubscriptionNoticeRow): SubscriptionNoticeDelivery {
    const { recipients, channel } = row;
    if (
        !Array.isArray(recipients) ||
        !recipients.every((recipient) => typeof recipient === 'string') ||
        channel === null
    ) {
        throw new Error(
            `${TABLE} row '${row.id}' is delivered, but its recipients are not a list of ` +
                'strings or its channel is missing.',
        );
    }
    return { recipients: [...(recipients as string[])], channel };
}
