// What every change of a booking's add-on version holds itself to: an early
// switch to a retirement's replacement, a retirement's move, a newer version
// taken at once, and one taken for the end of the term.
//
// Each claims the booking with a write conditional on the version it is on,
// and then writes the contract that names the new one. The two are one: where
// the contract cannot be written, or the subscription it was decided on moved
// in between, the booking goes back onto the version it left. And where the
// booking ended before a run made a move due for it, the periods the journal
// held back for the move are charged at the version it ran on, asked for by
// the run that finds it so.

import type { Logger } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';
import {
    BILLING_ERROR_CODES,
    type SubscriptionBundleRepository,
    type SubscriptionUsagePort,
    type SubscriptionUsageRecord,
} from '@saasicat/core';

import type { EntitlementService } from '../entitlement/entitlement.service.js';
import type { SubscriberChargeService } from './charges/subscriber-charge.service.js';

/**
 * The subscription's fields a change of a booking's version is decided on:
 * which one it is, its state, its plan and rhythm, a change it scheduled, and
 * a cancellation.
 */
const DECIDED_ON = [
    'id',
    'status',
    'plan',
    'billingCycle',
    'pendingPlan',
    'pendingBillingCycle',
    'pendingEffectiveAt',
    'canceledAt',
    'canceledEffectiveAt',
] as const satisfies readonly (keyof SubscriptionUsageRecord)[];

/** Whether `after` is the subscription a change was decided on as `before`. */
export function decidedAlike(
    before: SubscriptionUsageRecord,
    after: SubscriptionUsageRecord,
): boolean {
    return DECIDED_ON.every((field) => sameValue(before[field], after[field]));
}

function sameValue(a: unknown, b: unknown): boolean {
    return a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
}

export function subscriptionChanged(): ConflictException {
    return new ConflictException({
        code: BILLING_ERROR_CODES.SUBSCRIPTION_CHANGED,
        message: 'This subscription changed while the request was being decided. Reload it.',
    });
}

/** A booking moved from one add-on version to another, and the tenant it belongs to. */
export interface BookingMove {
    readonly tenantId: string;
    readonly subscriptionBundleId: string;
    /** The version it left. */
    readonly from: string;
    /** The version it is on now. */
    readonly to: string;
}

/**
 * Moves the booking back onto the version it left, where its move cannot
 * stand; whether that was written. Where it was not — the booking changed in
 * between, or the store failed — the booking is on the new version without its
 * contract, and the log names it.
 */
export async function putBookingBack(
    bookings: Pick<SubscriptionBundleRepository, 'moveToVersion'>,
    entitlements: Pick<EntitlementService, 'invalidateTenant'>,
    logger: Logger,
    move: BookingMove,
): Promise<boolean> {
    let why: string;
    try {
        // Present wherever a booking could be moved in the first place.
        const back = await bookings.moveToVersion!(move.subscriptionBundleId, move.to, move.from);
        if (back) return true;
        why = 'it changed in between';
    } catch (error) {
        why = String(error);
    } finally {
        entitlements.invalidateTenant(move.tenantId);
    }
    logger.error(
        `Booking ${move.subscriptionBundleId} of tenant ${move.tenantId} is on version ` +
            `${move.to} without its contract, and could not be put back: ${why}.`,
    );
    return false;
}

/** A booking a move was due for, and whose it is. */
export interface UnmovedBooking {
    readonly tenantId: string;
    readonly subscriptionId: string;
    readonly subscriptionBundleId: string;
}

/**
 * Asks the journal for the periods of a booking that ran past the moment it
 * was to move and ended before a run moved it. They waited for the move while
 * the booking ran, and wait no more now that it has ended; nothing else need
 * ask for them again where the subscription has ended too.
 *
 * `unreachable` where the tenant is on another subscription now: the journal
 * charges the one it is on, and cannot reach the booking's periods. `failed`
 * where recording them failed, for the run to ask again. A trial is charged
 * nothing.
 */
export async function chargeWhatItRanOn(
    subscriptions: Pick<SubscriptionUsagePort, 'findForTenant'>,
    charges: Pick<SubscriberChargeService, 'recordDueCharges'> | null,
    logger: Logger,
    booking: UnmovedBooking,
): Promise<'charged' | 'unreachable' | 'failed'> {
    const sub = await subscriptions.findForTenant(booking.tenantId);
    if (sub?.id !== booking.subscriptionId) {
        logger.warn(
            `Booking ${booking.subscriptionBundleId} of tenant ${booking.tenantId} ended before ` +
                `it moved, on subscription ${booking.subscriptionId}, which the tenant is no ` +
                'longer on. Its periods from the moment it was to move are not charged from here.',
        );
        return 'unreachable';
    }
    if (sub.status === 'TRIAL' || !charges) return 'charged';
    try {
        await charges.recordDueCharges(booking.tenantId);
        return 'charged';
    } catch (error) {
        logger.error(
            `Recording the charges of booking ${booking.subscriptionBundleId}, which ended ` +
                `before it moved (tenant ${booking.tenantId}), failed: ${String(error)}`,
        );
        return 'failed';
    }
}
