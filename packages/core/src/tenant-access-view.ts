// A tenant's state as its own users read it (`SC-ADM-054`).
//
// The operator's view (`AdminTenantAccessReason`) carries the operator's note
// on a suspension and the subscriber whose record lists an invoice; a tenant's
// users are told neither. They are told what holds them back and from which
// day, and the invoice by its number only where they hold the billing
// permission — the permission that lets them pay it (`SC-ADM-055`). Where a
// subscription ended, every one of them is told the last day the tenant can
// still read and the day its data is deleted on (`SC-CANC-033`), and whether
// that day has come: until the deletion runs the data is still there, and a
// tenant read-only past the day is not to be told it can read only until a day
// gone by. Whether they can take the tenant's export, and who delivers it, is
// said to the tenant's administrator alone (`SC-PRIV-020`).

import {
    holdsOldestFirst,
    type TenantAccess,
    type TenantAccessHoldKind,
    type TenantAccessState,
} from './tenant-access.types.js';
import type { TenantExportDeliverer } from './tenant-data-export.types.js';
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
    /**
     * Whether the installation's day has reached `deletesOn`: the deletion is
     * due. Until it runs the data is still there, so a tenant still read-only
     * can still read it. `null` where `deletesOn` is.
     */
    deletionDue: boolean | null;
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
     * Whether this user can take the tenant's full export here: they are the
     * tenant's own administrator, an end of its subscription is recorded, the
     * installation can deliver the export, and the tenant is read-only — never
     * where the download would be refused, a suspension and a deletion under
     * way included.
     */
    mayExport: boolean;
    /**
     * Who delivers the export this user may take: `'platform'` from
     * `GET billing/export`, `'application'` from a download of the
     * application's own, which `TenantAccessBanner` starts through its
     * `take-export` listener. `null` where `mayExport` is false.
     */
    exportDeliveredBy: TenantExportDeliverer | null;
}

/** Who is told, and what the view of them is made from. */
export interface TenantAccessViewOptions {
    /** The installation's zone, which decides the day a reason began on and the day it is now. */
    timeZone: string;
    /** The moment the view is read at: its day in `timeZone` says whether a deletion is due. */
    now: Date;
    holdsBillingPermission: boolean;
    mayPay: boolean;
    /**
     * The numbers of the invoices the reasons name, by invoice id. Read only
     * for a user who holds the billing permission; an invoice absent from it
     * is named as none.
     */
    invoiceNumbers?: ReadonlyMap<string, string>;
    /**
     * Whether this user is the tenant's own administrator, the one user who
     * may take its export — not the operator acting as the tenant, whose
     * download would not be the tenant's acknowledgement.
     */
    isTenantAdministrator: boolean;
    /**
     * The deletion day of each ended subscription the reasons name, by
     * subscription id: read only where an `ended` reason is open. A
     * subscription absent from it has no end recorded yet.
     */
    deletionDays?: ReadonlyMap<string, CalendarDay>;
    /**
     * Whether the installation can deliver the tenant's export: the
     * application wired its port, or declared that it delivers the export
     * itself.
     */
    exportWired?: boolean;
    /** Who delivers the export where it is wired. Default `'platform'`. */
    exportDeliveredBy?: TenantExportDeliverer;
}

/** What `access` tells a user of the tenant, as `options` says who is asking. */
export function tenantAccessViewOf(
    access: TenantAccess,
    options: TenantAccessViewOptions,
): TenantAccessView {
    const numbers = options.holdsBillingPermission ? options.invoiceNumbers : undefined;
    const today = dayInZone(options.now, options.timeZone);
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
            deletionDue: deletesOn === null ? null : today >= deletesOn,
        };
    });
    const mayExport =
        options.isTenantAdministrator === true &&
        options.exportWired === true &&
        access.state === 'read-only' &&
        reasons.some((reason) => reason.kind === 'ended' && reason.deletesOn !== null);
    return {
        state: access.state,
        reasons,
        holdsBillingPermission: options.holdsBillingPermission,
        mayPay: options.holdsBillingPermission && options.mayPay,
        mayExport,
        exportDeliveredBy: mayExport ? (options.exportDeliveredBy ?? 'platform') : null,
    };
}
