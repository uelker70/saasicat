// A subscriber's tax origin, and the tax answers SaaSiCat stores, read back
// from what a row holds. Pure, and shared by every adapter and the platform.
//
// Both adapters store a VAT check's confirmation and a contract's treatment as
// JSON, so how that JSON reads back is decided here once: a value of the wrong
// shape reads as nothing rather than as half an answer. And what a write moves
// of the tax origin, and which check counts, is decided here once too, so an
// adapter applies the answer rather than deciding it again.

import type {
    SubscriberRecord,
    SubscriberTaxOriginField,
    SubscriberTaxOriginValues,
    SubscriberVatIdCheckRecord,
} from './subscriber.types.js';
import { SUBSCRIBER_TAX_ORIGIN_FIELDS } from './subscriber.types.js';
import type {
    SubscriberTaxOrigin,
    TaxTreatment,
    TaxTreatmentKind,
    VatIdCheck,
} from './tax.types.js';
import { TAX_TREATMENT_KINDS } from './tax.types.js';

/** A `subscriber_vat_id_checks` row as either adapter reads it back. */
export interface CanonicalSubscriberVatIdCheckRow {
    id: string;
    subscriberId: string;
    vatId: string;
    checkedAt: Date;
    valid: boolean;
    service: string;
    confirmation: unknown;
    recordedAt: Date;
}

/**
 * What an adapter decides a subscriber's treatment from: the record as it
 * stands, and the check that counts for its number now. The number counts as
 * validated only when that check is of the number the subscriber has and found
 * it valid.
 */
export function taxOriginOf(
    subscriber: Pick<SubscriberRecord, SubscriberTaxOriginField>,
    currentCheck: VatIdCheck | null,
): SubscriberTaxOrigin {
    const validated =
        subscriber.vatId !== null &&
        currentCheck?.valid === true &&
        currentCheck.vatId === subscriber.vatId;
    return {
        country: subscriber.country,
        business: subscriber.business,
        vatId: subscriber.vatId,
        validatedVatId: validated ? subscriber.vatId : null,
    };
}

/** The subscriber's number, and since when it holds it. */
export interface HeldVatId {
    vatId: string | null;
    /**
     * When the number was last set by a correction; `null` while it is the one
     * the subscriber was created with.
     */
    vatIdSince: Date | null;
}

/**
 * Whether a check just recorded is the one that counts from now on, given the
 * subscriber's number and the check that counts now. Only a check of the
 * number the subscriber holds, completed while it held it, and never over a
 * check that completed later:
 *
 * - A check completed before the number was last set says nothing about it:
 *   the number was away in between, and may have been revoked meanwhile.
 * - Two checks of one number can run side by side, and the one written last
 *   is not the latest — an older "valid" written after a newer "invalid" would
 *   validate a number the latest check refused. Of two checks with the same
 *   date, the one written last counts.
 *
 * `vatIdSince` and `checkedAt` are both the platform's clock; between two
 * instances, the window this leaves is the difference between their clocks.
 */
export function keepsVatIdCheck(
    held: HeldVatId,
    counting: VatIdCheck | null,
    check: VatIdCheck,
): boolean {
    if (held.vatId === null || check.vatId !== held.vatId) return false;
    if (held.vatIdSince !== null && check.checkedAt.getTime() < held.vatIdSince.getTime()) {
        return false;
    }
    if (counting === null || counting.vatId !== held.vatId) return true;
    return counting.checkedAt.getTime() <= check.checkedAt.getTime();
}

/** A recorded check read back; a confirmation of another shape reads as empty. */
export function toSubscriberVatIdCheckRecord(
    row: CanonicalSubscriberVatIdCheckRow,
): SubscriberVatIdCheckRecord {
    return {
        id: row.id,
        subscriberId: row.subscriberId,
        vatId: row.vatId,
        checkedAt: row.checkedAt,
        valid: row.valid,
        service: row.service,
        confirmation: textEntries(row.confirmation),
        recordedAt: row.recordedAt,
    };
}

/** A treatment as it is stored on a contract. */
export function taxTreatmentToJson(treatment: TaxTreatment): Record<string, unknown> {
    return {
        kind: treatment.kind,
        rate: treatment.rate,
        note: treatment.note,
        adapter: { name: treatment.adapter.name, version: treatment.adapter.version },
    };
}

/** A stored treatment read back, or `null` where none is stored or it has another shape. */
export function toTaxTreatment(value: unknown): TaxTreatment | null {
    if (!isObject(value)) return null;
    const { kind, rate, note, adapter } = value;
    if (!isTreatmentKind(kind)) return null;
    if (typeof rate !== 'number' || !Number.isFinite(rate)) return null;
    if (note !== null && typeof note !== 'string') return null;
    if (!isObject(adapter)) return null;
    if (typeof adapter.name !== 'string' || typeof adapter.version !== 'string') return null;
    return { kind, rate, note, adapter: { name: adapter.name, version: adapter.version } };
}

/** What a write moves of a subscriber's tax origin, and what follows from it. */
export interface TaxOriginWrite {
    /** The values the write replaces, holding only the fields it moves. */
    previous: SubscriberTaxOriginValues;
    /** The values it writes, holding only the fields it moves. */
    changed: SubscriberTaxOriginValues;
    /** Whether it moves anything, and so has a change to record. */
    moved: boolean;
    /**
     * Whether it moves the VAT identification number. The check that counted
     * for the old number then counts no more — it says nothing about the new
     * one, nor about the old one should it come back later — while the check
     * itself stays recorded; and the number held is held since this write
     * (`HeldVatId.vatIdSince`).
     */
    endsCountingVatIdCheck: boolean;
}

/**
 * What a write moves of the tax origin: every field named whose stored value
 * differs, with the value it replaces. Every adapter asks this under the lock
 * it read `current` with, and applies the answer: a change is recorded only
 * when it moved something.
 */
export function taxOriginWrite(
    current: Pick<SubscriberRecord, SubscriberTaxOriginField>,
    next: SubscriberTaxOriginValues,
): TaxOriginWrite {
    const previous: Record<string, unknown> = {};
    const changed: Record<string, unknown> = {};
    for (const field of SUBSCRIBER_TAX_ORIGIN_FIELDS) {
        const value = next[field];
        if (value === undefined || value === current[field]) continue;
        previous[field] = current[field];
        changed[field] = value;
    }
    return {
        previous: previous as SubscriberTaxOriginValues,
        changed: changed as SubscriberTaxOriginValues,
        moved: Object.keys(changed).length > 0,
        endsCountingVatIdCheck: Object.prototype.hasOwnProperty.call(changed, 'vatId'),
    };
}

/** Stored tax origin values read back, holding only the fields that are there. */
export function toTaxOriginValues(value: unknown): SubscriberTaxOriginValues {
    if (!isObject(value)) return {};
    const values: Record<string, unknown> = {};
    for (const field of SUBSCRIBER_TAX_ORIGIN_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(value, field)) continue;
        const entry = value[field];
        if (field === 'business') {
            values[field] = typeof entry === 'boolean' ? entry : null;
        } else {
            values[field] = typeof entry === 'string' ? entry : null;
        }
    }
    return values as SubscriberTaxOriginValues;
}

function isTreatmentKind(value: unknown): value is TaxTreatmentKind {
    return (TAX_TREATMENT_KINDS as readonly unknown[]).includes(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function textEntries(value: unknown): Record<string, string> {
    if (!isObject(value)) return {};
    const entries: Record<string, string> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (typeof entry === 'string') entries[key] = entry;
    }
    return entries;
}
