// What the banner says of a tenant held back (`SC-ADM-054`): the state in the
// words a refused request uses for it, so a user reads one sentence for it
// wherever they meet it, and beneath it one line per reason, each from its day.
// An ended subscription's line goes on with the last day the tenant can read
// and the day its data is deleted on (`SC-CANC-033`): while the tenant is
// read-only before that day, in the words its end was confirmed with, which say
// it can still read; read-only once the day has come and nothing has deleted
// the data yet, as a deletion that is due, which it can still read until; in
// any other state, which lets nothing be read, as the two days alone.

import {
    ERROR_MESSAGES_EN,
    TENANT_ACCESS_ERROR_CODES,
    resolveErrorMessage,
    type TenantAccessReasonView,
    type TenantAccessState,
    type TenantAccessView,
} from '@saasicat/core';
import { formatMessage } from '@saasicat/ui-vue';

import { deletionSentence, type DeletionDays } from '../announced-deletion.js';
import { writeDay } from '../day-as-instant.js';
import type { TenantPlanSectionI18n } from '../default-i18n.js';
import { refusalOf } from '../refusal-of.js';

type AccessTexts = Pick<
    TenantPlanSectionI18n,
    | 'accessReasonOverdue'
    | 'accessReasonOverdueUnnamed'
    | 'accessReasonSuspended'
    | 'accessReasonEnded'
    | 'accessReasonDeleting'
    | 'deletionAnnounced'
    | 'accessReasonEndedDays'
    | 'accessReasonEndedDeletionDue'
    | 'issueMessages'
>;

const CODE_OF_STATE: Readonly<Record<Exclude<TenantAccessState, 'open'>, string>> = {
    'read-only': TENANT_ACCESS_ERROR_CODES.TENANT_READ_ONLY,
    suspended: TENANT_ACCESS_ERROR_CODES.TENANT_SUSPENDED,
    deleting: TENANT_ACCESS_ERROR_CODES.TENANT_BEING_DELETED,
};

/** Every code the platform words, whichever language the application chose. */
const PLATFORM_CATALOGUE: Partial<Record<string, string>> = ERROR_MESSAGES_EN;

/** The sentence for `state`, as a request refused in it says it. */
export function accessStateSentence(
    state: Exclude<TenantAccessState, 'open'>,
    i18n: Pick<AccessTexts, 'issueMessages'>,
): string {
    return resolveErrorMessage({ code: CODE_OF_STATE[state] }, i18n.issueMessages);
}

/**
 * One line for `reason` while the tenant is in `state`, each day written as
 * `formatDate` writes a day.
 */
export function accessReasonLine(
    reason: TenantAccessReasonView,
    state: Exclude<TenantAccessState, 'open'>,
    i18n: AccessTexts,
    formatDate: (iso: string) => string,
): string {
    const date = writeDay(formatDate, reason.since);
    switch (reason.kind) {
        case 'overdue':
            return reason.invoiceNumber === null
                ? formatMessage(i18n.accessReasonOverdueUnnamed, { date })
                : formatMessage(i18n.accessReasonOverdue, { date, number: reason.invoiceNumber });
        case 'suspended':
            return formatMessage(i18n.accessReasonSuspended, { date });
        case 'ended': {
            const ended = formatMessage(i18n.accessReasonEnded, { date });
            const days = endedDaysOf(reason);
            const template = endedDaysTemplate(state, reason.deletionDue === true, i18n);
            const deletion = deletionSentence(template, days, formatDate);
            return deletion === null ? ended : `${ended} ${deletion}`;
        }
        case 'deleting':
            return formatMessage(i18n.accessReasonDeleting, { date });
    }
}

/**
 * The sentence an ended subscription's two days are named in. Where the tenant
 * is read-only, that it can still read: until the first day while the deletion
 * day has not come, and until the deletion runs once it is due — saying then
 * that it can read only until a day gone by, or that it is deleted on a day
 * gone by, would be false. A suspension or a deletion under way lets nothing be
 * read, so there the days stand alone.
 */
export function endedDaysTemplate(
    state: Exclude<TenantAccessState, 'open'>,
    deletionDue: boolean,
    i18n: Pick<
        AccessTexts,
        'deletionAnnounced' | 'accessReasonEndedDays' | 'accessReasonEndedDeletionDue'
    >,
): string {
    if (state !== 'read-only') return i18n.accessReasonEndedDays;
    return deletionDue ? i18n.accessReasonEndedDeletionDue : i18n.deletionAnnounced;
}

/** The two days an ended subscription leaves, where its end is recorded; `null` until then. */
function endedDaysOf(reason: TenantAccessReasonView): DeletionDays | null {
    const { readOnlyUntil, deletesOn } = reason;
    return readOnlyUntil === null || deletesOn === null ? null : { readOnlyUntil, deletesOn };
}

/**
 * Why the export did not arrive, in the reader's language: a refusal the
 * platform words — the export not offered or not produced, the tenant
 * suspended or being deleted, the administrator's role missing — in its own
 * sentence, and anything else, a connection that broke or a failure the server
 * names no code for, as `fallback`. Never a code, and never the server's own
 * text for a failure it did not word.
 */
export function exportFailureSentence(
    err: unknown,
    i18n: Pick<AccessTexts, 'issueMessages'>,
    fallback: string,
): string {
    const body = refusalOf(err);
    const code = typeof body?.code === 'string' ? body.code : null;
    if (body === null || code === null) return fallback;
    const worded =
        typeof i18n.issueMessages[code] === 'string' ||
        typeof PLATFORM_CATALOGUE[code] === 'string';
    return worded ? resolveErrorMessage(body, i18n.issueMessages) : fallback;
}

/** A tenant's state where something holds it back. */
export type HeldBackView = TenantAccessView & { state: Exclude<TenantAccessState, 'open'> };

/** `view` where something holds the tenant back; `null` where it is open or not known. */
export function heldBackView(view: TenantAccessView | null): HeldBackView | null {
    if (view === null) return null;
    const { state } = view;
    return state === 'open' ? null : { ...view, state };
}
