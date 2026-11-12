// A tenant's state as its own users read it (`SC-ADM-054`).
//
// The operator's view (`AdminTenantAccessReason`) carries the operator's note
// on a suspension and the subscriber whose record lists an invoice; a tenant's
// users are told neither. They are told what holds them back and from which
// day, and the invoice by its number only where they hold the billing
// permission — the permission that lets them pay it (`SC-ADM-055`).

import {
    holdsOldestFirst,
    type TenantAccess,
    type TenantAccessHoldKind,
    type TenantAccessState,
} from './tenant-access.types.js';
import { dayInZone, type CalendarDay } from './zoned-day.js';

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
}

/** What `access` tells a user of the tenant, as `options` says who is asking. */
export function tenantAccessViewOf(
    access: TenantAccess,
    options: TenantAccessViewOptions,
): TenantAccessView {
    const numbers = options.holdsBillingPermission ? options.invoiceNumbers : undefined;
    return {
        state: access.state,
        reasons: holdsOldestFirst(access.holds).map((hold) => ({
            kind: hold.kind,
            since: dayInZone(hold.since, options.timeZone),
            invoiceNumber:
                hold.kind === 'overdue' && hold.reference !== null
                    ? (numbers?.get(hold.reference) ?? null)
                    : null,
        })),
        holdsBillingPermission: options.holdsBillingPermission,
        mayPay: options.holdsBillingPermission && options.mayPay,
    };
}
