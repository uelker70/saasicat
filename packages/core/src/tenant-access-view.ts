// A tenant's state as its own users read it (`SC-ADM-054`).
//
// The operator's view (`AdminTenantAccessReason`) carries the operator's note
// on a suspension and the subscriber whose record lists an invoice; a tenant's
// users are told neither. They are told what holds them back and from which
// day, and the invoice by its number only where they hold the billing
// permission — the permission that lets them pay it (`SC-ADM-055`). Where a
// subscription ended, every one of them is told the last day the tenant can
// still read and the day its data is deleted on (`SC-CANC-033`); whether they
// can take the tenant's export is said to the tenant's administrator alone
// (`SC-PRIV-019`).

import {
    holdsOldestFirst,
    type TenantAccess,
    type TenantAccessHoldKind,
    type TenantAccessState,
} from './tenant-access.types.js';
import { addDaysToDay, dayInZone, type CalendarDay } from './zoned-day.js';

/** One reason a tenant is held back, as its own users are told it. */
export interface TenantAccessReasonView {
    kind: TenantAccessHoldKind;
    /** The installation's day it began to hold. */
    since: CalendarDay;
    /**
     * The invoice unpaid on its due date, by its number: only to a user who
     * holds the billing permission, and only where invoices are wired; `null`
     * otherwise.
     */
    invoiceNumber: string | null;
    /**
     * The last day the tenant can still read on, the day before `deletesOn`,
     * for an ended subscription whose end is recorded; `null` for every other
     * kind, and while the end is not recorded yet.
     */
    readOnlyUntil: CalendarDay | null;
    /**
     * The installation's day the tenant's data is deleted on, for an ended
     * subscription whose end is recorded; `null` otherwise, as `readOnlyUntil`.
     */
    deletesOn: CalendarDay | null;
}

/** A tenant's state as its own users read it. */
export interface TenantAccessView {
    state: TenantAccessState;
    /** Every reason it is held back for, the oldest first; none where it is open. */
    reasons: TenantAccessReasonView[];
    /** Whether this user holds the billing permission, and so is told the invoices by number. */
    holdsBillingPermission: boolean;
    /**
     * Whether this user can pay here what is open: they hold the billing
     * permission, and the installation collects through a payment gateway.
     */
    mayPay: boolean;
    /**
     * Whether this user can take the tenant's full export here
     * (`GET billing/export`): they are the tenant's administrator, an end of
     * its subscription is recorded, the installation can produce the export,
     * and the tenant is read-only — never where the route would refuse it, a
     * suspension and a deletion under way included.
     */
    mayExport: boolean;
}

/** Who is told, and what the view of them is made from. */
export interface TenantAccessViewOptions {
    /** The installation's zone, which decides the day a reason began on. */
    timeZone: string;
    holdsBillingPermission: boolean;
    mayPay: boolean;
    /**
     * The numbers of the invoices the reasons name, by invoice id. Read only
     * for a user who holds the billing permission; an invoice absent from it
     * is named as none.
     */
    invoiceNumbers?: ReadonlyMap<string, string>;
    /** Whether this user is the tenant's administrator, the one user who may take its export. */
    isTenantAdministrator: boolean;
    /**
     * The deletion day of each ended subscription the reasons name, by
     * subscription id: read only where an `ended` reason is open. A
     * subscription absent from it has no end recorded yet.
     */
    deletionDays?: ReadonlyMap<string, CalendarDay>;
    /** Whether the installation can produce the tenant's export: the application wired its port. */
    exportWired?: boolean;
}

/** What `access` tells a user of the tenant, as `options` says who is asking. */
export function tenantAccessViewOf(
    access: TenantAccess,
    options: TenantAccessViewOptions,
): TenantAccessView {
    const numbers = options.holdsBillingPermission ? options.invoiceNumbers : undefined;
    const reasons = holdsOldestFirst(access.holds).map((hold) => {
        const deletesOn =
            hold.kind === 'ended' && hold.reference !== null
                ? (options.deletionDays?.get(hold.reference) ?? null)
                : null;
        return {
            kind: hold.kind,
            since: dayInZone(hold.since, options.timeZone),
            invoiceNumber:
                hold.kind === 'overdue' && hold.reference !== null
                    ? (numbers?.get(hold.reference) ?? null)
                    : null,
            readOnlyUntil: deletesOn === null ? null : addDaysToDay(deletesOn, -1),
            deletesOn,
        };
    });
    return {
        state: access.state,
        reasons,
        holdsBillingPermission: options.holdsBillingPermission,
        mayPay: options.holdsBillingPermission && options.mayPay,
        mayExport:
            options.isTenantAdministrator === true &&
            options.exportWired === true &&
            access.state === 'read-only' &&
            reasons.some((reason) => reason.kind === 'ended' && reason.deletesOn !== null),
    };
}
