// Pure-Function-Bausteine für PlanVersion-Renewal- und Period-Roll-Logik.
//
// Konsumenten implementieren den Cron-Job-Loop (DB-Query, Transaction,
// Audit, Cache-Invalidate) — die Plattform liefert die hier definierten
// **Entscheidungs-Pure-Functions**, die für jede Subscription bestimmen,
// was zu tun ist.

import type { BillingCycle } from '@saasicat/types';
import { periodEndAfter } from './billing-period.js';

/**
 * Was der Renewal-Cron mit einer Subscription tun soll, deren
 * `pendingPlanVersionEffectiveAt` erreicht ist.
 *
 *   - `ROLL_FORWARD`: Pending wird zur neuen Live-Version. Tritt ein, wenn
 *     entweder `nonRegressive=true` (Plattform-Garantie: keine Regression)
 *     oder `accepted=true` (Tenant hat dem Wechsel zugestimmt).
 *   - `CLEAR_PENDING`: Pending wird verworfen. Tritt ein, wenn die
 *     Pending-Version regressiv ist UND der Tenant bis zum Effektiv-Datum
 *     **nicht** zugestimmt hat (Variante B aus Roadmap §6.2: Opt-in
 *     verpasst → kein Wechsel).
 *   - `SKIP`: Sub hat keine pending-Version oder das Effektiv-Datum ist
 *     noch in der Zukunft. (Sollte vom Cron-Filter normalerweise gar nicht
 *     gefunden werden — defensiv hier abgefangen.)
 */
export type RenewalDecision = 'ROLL_FORWARD' | 'CLEAR_PENDING' | 'SKIP';

/** Eingabe-Form für `decideRenewal` (was der Cron aus der Sub ausliest). */
export interface RenewalSubInput {
    pendingPlanVersionId: string | null;
    pendingPlanVersionEffectiveAt: Date | null;
    pendingPlanVersionAccepted: boolean;
    /** `nonRegressive` aus der referenzierten PlanVersion. */
    pendingPlanVersionNonRegressive: boolean;
}

/**
 * Entscheidet, was mit einer Subscription mit fälliger Pending-Version
 * geschehen soll.
 */
export function decideRenewal(sub: RenewalSubInput, now: Date): RenewalDecision {
    if (!sub.pendingPlanVersionId || !sub.pendingPlanVersionEffectiveAt) return 'SKIP';
    if (sub.pendingPlanVersionEffectiveAt > now) return 'SKIP';
    if (sub.pendingPlanVersionNonRegressive || sub.pendingPlanVersionAccepted) {
        return 'ROLL_FORWARD';
    }
    return 'CLEAR_PENDING';
}

/**
 * Liefert die Felder, die nach einem `ROLL_FORWARD` oder `CLEAR_PENDING`
 * im Subscription-Update zurückgesetzt werden müssen. Konsument fügt sie
 * in seinen Prisma-`update.data`-Block ein.
 */
export function clearPendingPlanVersionFields(): {
    pendingPlanVersionId: null;
    pendingPlanVersionEffectiveAt: null;
    pendingPlanVersionAccepted: false;
    pendingPlanVersionAcceptedAt: null;
    pendingPlanVersionAcceptedByUserId: null;
    pendingPlanVersionNotifiedAt: null;
    pendingPlanVersionReminderSentAt: null;
} {
    return {
        pendingPlanVersionId: null,
        pendingPlanVersionEffectiveAt: null,
        pendingPlanVersionAccepted: false,
        pendingPlanVersionAcceptedAt: null,
        pendingPlanVersionAcceptedByUserId: null,
        pendingPlanVersionNotifiedAt: null,
        pendingPlanVersionReminderSentAt: null,
    };
}

/** Eingabe-Form für `computeNextPeriod`. */
export interface PeriodRollInput {
    /** Subscription.currentPeriodEnd. NULL → keine Periode aktiv → SKIP. */
    currentPeriodEnd: Date | null;
    billingCycle: BillingCycle;
    canceledAt: Date | null;
}

/** Ergebnis: das nächste Period-Window oder `null` (Skip). */
export interface NextPeriodWindow {
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
}

/**
 * Berechnet das nächste Periodenfenster. `null` bedeutet: keine Aktion
 * (entweder Periode noch nicht erreicht, gekündigt, oder NULL-Periode).
 *
 * Logik (Spec: SUPERADMIN_PLANS_DASHBOARD_TODO §2.2):
 *   - Wenn `canceledAt` gesetzt ist → SKIP.
 *   - Wenn `currentPeriodEnd === null` → SKIP (Trial / PENDING_SALES).
 *   - Wenn `currentPeriodEnd > now` → SKIP (Periode noch aktiv).
 *   - Sonst → Start := alte `currentPeriodEnd`, End := periodEndAfter(Start).
 */
export function computeNextPeriod(sub: PeriodRollInput, now: Date): NextPeriodWindow | null {
    if (sub.canceledAt !== null) return null;
    if (sub.currentPeriodEnd === null) return null;
    if (sub.currentPeriodEnd > now) return null;
    const newStart = sub.currentPeriodEnd;
    const newEnd = periodEndAfter(newStart, sub.billingCycle, now);
    return { currentPeriodStart: newStart, currentPeriodEnd: newEnd };
}
