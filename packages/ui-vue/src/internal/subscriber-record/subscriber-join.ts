// What joining a returning customer's subscriber into the one it had shows and
// sends (`SC-ADM-027`), read off the preview and the form. Framework-free, so
// the rules are functions a test calls without mounting the dialog.

import {
    LEGAL_IDENTITY_FIELDS,
    SUBSCRIBER_OWNED_TABLES,
    type AdminSubscriberDetails,
    type AdminSubscriberJoinPreview,
    type LegalIdentityField,
    type SubscriberOwnedTable,
} from '@saasicat/core';

import type { SubscriberJoinInput } from '../../client/resources/subscribers.resource.js';

/** The fields of the address an invoice names: a join replaces them as one. */
const ADDRESS_FIELDS = ['addressLine1', 'addressLine2', 'postalCode', 'city', 'country'] as const;

/** One kind of row that moves, and how many. */
export interface JoinMoving {
    table: SubscriberOwnedTable;
    count: number;
}

/** One change the earlier subscriber's record takes, as the preview names it. */
export type JoinChange =
    | { kind: 'address'; previous: string; next: string }
    | { kind: 'invoiceEmail'; previous: string | null; next: string | null }
    | { kind: 'business'; previous: boolean | null; next: boolean | null }
    | { kind: 'identity'; field: LegalIdentityField; previous: string | null; next: string | null };

/**
 * What a join does to the payment methods: the earlier subscriber's go out of
 * use, and this subscriber's takes over — or, where it brings none, none is in
 * use afterwards. `null` where none goes out of use.
 */
export type JoinPaymentMethodNote = 'taken-over' | 'none-taken-over';

export function joinPaymentMethodNoteOf(
    preview: AdminSubscriberJoinPreview,
): JoinPaymentMethodNote | null {
    if (preview.paymentMethodsOutOfUse === 0) return null;
    return preview.paymentMethodsTakenOver > 0 ? 'taken-over' : 'none-taken-over';
}

/** What moves, in the order a join moves it, only what holds a row. */
export function joinMovingOf(preview: AdminSubscriberJoinPreview): JoinMoving[] {
    return SUBSCRIBER_OWNED_TABLES.flatMap(({ table }) => {
        const count = preview.moving[table] ?? 0;
        return count > 0 ? [{ table, count }] : [];
    });
}

/** The address as one line, the parts it has in the order an envelope writes them. */
export function addressLineOf(
    subscriber: Pick<AdminSubscriberDetails, (typeof ADDRESS_FIELDS)[number]>,
): string {
    const place = [subscriber.postalCode, subscriber.city].filter(Boolean).join(' ');
    return [subscriber.addressLine1, subscriber.addressLine2, place, subscriber.country]
        .filter(Boolean)
        .join(', ');
}

/**
 * Every change the earlier subscriber's record takes: the address as a whole,
 * the invoice email and the business status, as sign-up gave them, and each
 * field of the legal identity corrected as the same legal entity.
 */
export function joinChangesOf(preview: AdminSubscriberJoinPreview): JoinChange[] {
    const changes: JoinChange[] = [];
    const replaced = (field: string) => preview.replaced.find((each) => each.field === field);
    if (ADDRESS_FIELDS.some((field) => replaced(field))) {
        changes.push({
            kind: 'address',
            previous: addressLineOf(preview.into.subscriber),
            next: addressLineOf(preview.from.subscriber),
        });
    }
    if (replaced('invoiceEmail')) {
        changes.push({
            kind: 'invoiceEmail',
            previous: preview.into.subscriber.invoiceEmail,
            next: preview.from.subscriber.invoiceEmail,
        });
    }
    if (replaced('business')) {
        changes.push({
            kind: 'business',
            previous: preview.into.subscriber.business,
            next: preview.from.subscriber.business,
        });
    }
    const corrected = preview.corrected;
    if (corrected) {
        for (const field of LEGAL_IDENTITY_FIELDS) {
            const next = corrected.corrected[field];
            if (next === undefined) continue;
            changes.push({
                kind: 'identity',
                field,
                previous: corrected.previous[field] ?? null,
                next,
            });
        }
    }
    return changes;
}

/**
 * The join the form describes, or `null` while it describes none: no preview
 * yet, no reason, or the operator has not declared both one legal entity.
 */
export function joinInputOf(
    preview: AdminSubscriberJoinPreview | null,
    form: { reason: string; sameEntity: boolean },
): SubscriberJoinInput | null {
    const reason = form.reason.trim();
    if (!preview || reason === '' || !form.sameEntity) return null;
    return {
        intoSubscriberId: preview.into.subscriber.id,
        reason,
        previewDigest: preview.digest,
    };
}
