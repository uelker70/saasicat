// Where a tenant's deletion stands, worded once for the tenant's page and its
// subscriber's record (`SC-ADM-058`), and what the record keeps of it
// (`SC-PRIV-024`). The platform decides the state (`tenantDeletionStatusOf` in
// core); this only words it, in the order it was decided in: every reason that
// holds the deletion in the order the run asks them, and before the day the
// same reasons as the forecast of what the day would bring (`SC-PRIV-021`).
//
// A reason names what the operator needs to act on it elsewhere — the
// installation's identifiers and the command that marks the database, the
// store and every part of the commercial record that fell. A failure is named
// by the code it was kept under; one the platform found itself is explained,
// one of the application's stands as it was kept.
//
// Framework-free, so it is tested without a browser.

import {
    COMMERCIAL_RECORD_FIELDS,
    commercialRecordLost,
    isTenantDeletionPlatformFailureCode,
    type AdminTenantDeletion,
    type AdminTenantDeletionFailure,
    type AdminTenantDeletionRecord,
    type AdminTenantDeletionStatus,
    type CalendarDay,
    type CommercialRecordCounts,
    type TenantCount,
    type TenantDeletionHaltReason,
} from '@saasicat/core';

import { formatMessage } from './i18n/format.js';
import type { SaMessages } from './i18n/messages.js';

/** The words of where a deletion stands, from `tenants.detail.deletion`. */
export type TenantDeletionMessages = SaMessages['tenants']['detail']['deletion'];

/** The words of what a subscriber's record keeps of a deletion. */
export interface TenantDeletionRecordMessages {
    deletion: TenantDeletionMessages;
    record: SaMessages['subscribers']['record']['deletions'];
}

/** How the page writes a day and a moment. */
export interface TenantDeletionWriters {
    day: (day: CalendarDay) => string;
    /** A moment, ISO 8601. */
    moment: (iso: string) => string;
}

/** How the page writes a day, a moment and the size of a file. */
export interface TenantDeletionRecordWriters extends TenantDeletionWriters {
    /** A size in bytes. */
    size: (bytes: number) => string;
}

/** Where a deletion stands, in words. */
export interface TenantDeletionWording {
    /** The state, for its pill. */
    label: string;
    /** What the state says: its day or moment, how far it got, its last failure. */
    lines: string[];
    /** Every reason that holds it — or, before its day, would — in the order the run asks them. */
    reasons: string[];
}

/** One store's part in a deletion, in words. */
export interface TenantDeletionStoreRow {
    store: string;
    counted: string;
    erased: string;
    /** What it counted, by the application's category keys, as kept. */
    counts: readonly TenantCount[];
}

/** One part of the subscriber's commercial record, before and after the stores erased. */
export interface TenantDeletionCommercialRow {
    part: string;
    /** `null` until it was counted. */
    before: number | null;
    after: number | null;
    /** Whether it fell. */
    lost: boolean;
}

/** One reminder of the deletion, in words. */
export interface TenantDeletionReminderRow {
    daysBefore: number;
    recorded: string;
    /** When it was delivered, or that it was not. */
    delivered: string;
    /** `null` while it is not delivered. */
    channel: string | null;
    /** How many it reached, or that it reached nobody; `null` while it is not delivered. */
    recipients: string | null;
}

/** One download of the export, in words. */
export interface TenantDeletionDownloadRow {
    at: string;
    size: string;
    /** The role that took it. */
    by: string;
}

/** What a subscriber's record keeps of a deletion, in words. */
export interface TenantDeletionRecordWording {
    /** Since when the export was offered, whether a suspension kept it, whether the day was told. */
    export: string[];
    stores: TenantDeletionStoreRow[];
    commercial: TenantDeletionCommercialRow[];
    reminders: TenantDeletionReminderRow[];
    downloads: TenantDeletionDownloadRow[];
}

/** The parts that fell, each with its count before and after, joined. */
function lostPartsOf(
    lost: readonly (keyof CommercialRecordCounts)[],
    record: AdminTenantDeletionRecord | null,
    messages: TenantDeletionMessages,
): string {
    const before = record?.commercialBefore ?? null;
    const after = record?.commercialAfter ?? null;
    return lost
        .map((field) =>
            before && after
                ? formatMessage(messages.lostPart, {
                      part: messages.parts[field],
                      before: before[field],
                      after: after[field],
                  })
                : messages.parts[field],
        )
        .join(', ');
}

/** One reason that holds a deletion, with what it names. */
function reasonOf(
    held: TenantDeletionHaltReason,
    record: AdminTenantDeletionRecord | null,
    messages: TenantDeletionMessages,
): string {
    switch (held.reason) {
        case 'installation-unmarked':
            return formatMessage(messages.reasons[held.reason], { expected: held.expected });
        case 'installation-differs':
            return formatMessage(messages.reasons[held.reason], {
                expected: held.expected,
                marked: held.marked,
            });
        case 'no-subscriber':
        case 'contract-runs-past-end':
            return messages.reasons[held.reason];
        case 'commercial-record-lost': {
            const lost = lostPartsOf(held.lost, record, messages);
            return held.store === null
                ? formatMessage(messages.commercialRecordLostNoStore, { lost })
                : formatMessage(messages.reasons[held.reason], { store: held.store, lost });
        }
    }
}

/** The last failure, by its code, and what it means where the platform found it itself. */
function failureLinesOf(
    failure: AdminTenantDeletionFailure,
    messages: TenantDeletionMessages,
    write: TenantDeletionWriters,
): string[] {
    const named = {
        moment: write.moment(failure.at),
        step: messages.steps[failure.step],
        code: failure.code,
    };
    const line =
        failure.store === null
            ? formatMessage(messages.lastFailureNoStore, named)
            : formatMessage(messages.lastFailure, { ...named, store: failure.store });
    return isTenantDeletionPlatformFailureCode(failure.code)
        ? [line, messages.failures[failure.code]]
        : [line];
}

/** What the state says, apart from its reasons. */
function linesOf(
    status: AdminTenantDeletionStatus,
    record: AdminTenantDeletionRecord | null,
    messages: TenantDeletionMessages,
    write: TenantDeletionWriters,
): string[] {
    const day = write.day(status.deletesOn);
    switch (status.kind) {
        case 'scheduled': {
            const scheduled = formatMessage(messages.scheduled, { day });
            return status.wouldBeHeldBy.length > 0
                ? [scheduled, messages.wouldBeHeld]
                : [scheduled];
        }
        case 'due':
            return [formatMessage(messages.due, { day })];
        case 'halted':
            return [
                record
                    ? formatMessage(messages.haltedBegun, {
                          moment: write.moment(record.startedAt),
                      })
                    : formatMessage(messages.haltedDue, { day }),
            ];
        case 'running':
            return [
                formatMessage(messages.running, {
                    moment: write.moment(status.startedAt),
                    erased: status.storesErased,
                    total: status.storesTotal,
                }),
                ...(status.lastFailure ? failureLinesOf(status.lastFailure, messages, write) : []),
            ];
        case 'retrying':
            return [
                formatMessage(messages.retrying, {
                    moment: write.moment(status.startedAt),
                    attempts: status.attempts,
                }),
                ...failureLinesOf(status.lastFailure, messages, write),
            ];
        case 'deleted':
            return [formatMessage(messages.deleted, { moment: write.moment(status.closedAt) })];
    }
}

/** The reasons a state names: those that hold it, or before its day those that would. */
function reasonsNamedBy(status: AdminTenantDeletionStatus): readonly TenantDeletionHaltReason[] {
    if (status.kind === 'halted') return status.heldBy;
    if (status.kind === 'scheduled') return status.wouldBeHeldBy;
    return [];
}

/** Where `deletion` stands, in the words of `messages`. */
export function tenantDeletionWording(
    deletion: AdminTenantDeletion,
    messages: TenantDeletionMessages,
    write: TenantDeletionWriters,
): TenantDeletionWording {
    const { status, record } = deletion;
    return {
        label: messages.states[status.kind],
        lines: linesOf(status, record, messages, write),
        reasons: reasonsNamedBy(status).map((held) => reasonOf(held, record, messages)),
    };
}

function commercialRowsOf(
    record: AdminTenantDeletionRecord,
    messages: TenantDeletionMessages,
): TenantDeletionCommercialRow[] {
    const { commercialBefore: before, commercialAfter: after } = record;
    const lost = before && after ? commercialRecordLost(before, after) : [];
    return COMMERCIAL_RECORD_FIELDS.map((field) => ({
        part: messages.parts[field],
        before: before?.[field] ?? null,
        after: after?.[field] ?? null,
        lost: lost.includes(field),
    }));
}

function reminderRowsOf(
    record: AdminTenantDeletionRecord,
    messages: TenantDeletionRecordMessages['record'],
    write: TenantDeletionWriters,
): TenantDeletionReminderRow[] {
    return record.reminders.map((reminder) => {
        const recorded = write.moment(reminder.createdAt);
        if (reminder.deliveredAt === null) {
            return {
                daysBefore: reminder.daysBefore,
                recorded,
                delivered: messages.notDelivered,
                channel: null,
                recipients: null,
            };
        }
        return {
            daysBefore: reminder.daysBefore,
            recorded,
            delivered: write.moment(reminder.deliveredAt),
            channel: reminder.channel,
            recipients:
                reminder.recipientCount === 0
                    ? messages.reachedNobody
                    : String(reminder.recipientCount),
        };
    });
}

/** What the subscriber's record keeps of a begun deletion, in the words of `messages`. */
export function tenantDeletionRecordWording(
    record: AdminTenantDeletionRecord,
    messages: TenantDeletionRecordMessages,
    write: TenantDeletionRecordWriters,
): TenantDeletionRecordWording {
    const words = messages.record;
    return {
        export: [
            formatMessage(words.exportOffered, { moment: write.moment(record.exportOfferedFrom) }),
            record.exportBlockedBySuspension ? words.exportBlocked : words.exportNotBlocked,
            record.announcedOn === null
                ? words.notAnnounced
                : formatMessage(words.announced, { day: write.day(record.announcedOn) }),
        ],
        stores: record.stores.map((part) => ({
            store: part.store,
            counted:
                part.countedAt === null
                    ? words.notCounted
                    : formatMessage(words.counted, { moment: write.moment(part.countedAt) }),
            erased:
                part.erasedAt === null
                    ? words.notErased
                    : formatMessage(words.erased, { moment: write.moment(part.erasedAt) }),
            counts: part.counts,
        })),
        commercial: commercialRowsOf(record, messages.deletion),
        reminders: reminderRowsOf(record, words, write),
        downloads: record.downloads.map((download) => ({
            at: write.moment(download.at),
            size: write.size(download.size),
            by: words.roles[download.by],
        })),
    };
}
