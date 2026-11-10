// What the banner says of a tenant held back (`SC-ADM-054`): the state in the
// words a refused request uses for it, so a user reads one sentence for it
// wherever they meet it, and beneath it one line per reason, each from its day.

import {
    TENANT_ACCESS_ERROR_CODES,
    resolveErrorMessage,
    type CalendarDay,
    type TenantAccessReasonView,
    type TenantAccessState,
    type TenantAccessView,
} from '@saasicat/core';
import { formatMessage } from '@saasicat/ui-vue';

import type { TenantPlanSectionI18n } from '../default-i18n.js';

type AccessTexts = Pick<
    TenantPlanSectionI18n,
    | 'accessReasonOverdue'
    | 'accessReasonOverdueUnnamed'
    | 'accessReasonSuspended'
    | 'accessReasonEnded'
    | 'accessReasonDeleting'
    | 'issueMessages'
>;

const CODE_OF_STATE: Readonly<Record<Exclude<TenantAccessState, 'open'>, string>> = {
    'read-only': TENANT_ACCESS_ERROR_CODES.TENANT_READ_ONLY,
    suspended: TENANT_ACCESS_ERROR_CODES.TENANT_SUSPENDED,
    deleting: TENANT_ACCESS_ERROR_CODES.TENANT_BEING_DELETED,
};

/** The sentence for `state`, as a request refused in it says it. */
export function accessStateSentence(
    state: Exclude<TenantAccessState, 'open'>,
    i18n: Pick<AccessTexts, 'issueMessages'>,
): string {
    return resolveErrorMessage({ code: CODE_OF_STATE[state] }, i18n.issueMessages);
}

/** One line for `reason`, its day written by `writeDayOf`. */
export function accessReasonLine(
    reason: TenantAccessReasonView,
    i18n: AccessTexts,
    writeDayOf: (day: CalendarDay) => string,
): string {
    const date = writeDayOf(reason.since);
    switch (reason.kind) {
        case 'overdue':
            return reason.invoiceNumber === null
                ? formatMessage(i18n.accessReasonOverdueUnnamed, { date })
                : formatMessage(i18n.accessReasonOverdue, { date, number: reason.invoiceNumber });
        case 'suspended':
            return formatMessage(i18n.accessReasonSuspended, { date });
        case 'ended':
            return formatMessage(i18n.accessReasonEnded, { date });
        case 'deleting':
            return formatMessage(i18n.accessReasonDeleting, { date });
    }
}

/** A tenant's state where something holds it back. */
export type HeldBackView = TenantAccessView & { state: Exclude<TenantAccessState, 'open'> };

/** `view` where something holds the tenant back; `null` where it is open or not known. */
export function heldBackView(view: TenantAccessView | null): HeldBackView | null {
    if (view === null) return null;
    const { state } = view;
    return state === 'open' ? null : { ...view, state };
}
