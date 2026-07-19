import type { BillingCycle } from '@saasicat/types';

// Periodengrenz-Berechnungen für Subscriptions.
// Spec: handoff/superadmin/SPEC.md §6 + autohauspro/handoff/saas/ROADMAP_PLANS_AND_ENTITLEMENT.md §6.
//
// UTC-Methoden bewusst gewählt: bei lokal-relativem setMonth/setFullYear
// führen DST-Übergänge zu Off-by-one-Day im UTC-Output. Periodengrenzen
// sind UTC-stabil — wir wollen "1 Monat später, gleicher UTC-Tag".
//
// Aus autohauspro/backend/src/billing/billing-period.utils.ts extrahiert
// (P1-Slice, UMSETZUNGSPLAN.md §3.2).

function advanceOneCycle(d: Date, cycle: BillingCycle): Date {
    const out = new Date(d);
    if (cycle === 'YEARLY') {
        out.setUTCFullYear(out.getUTCFullYear() + 1);
    } else {
        out.setUTCMonth(out.getUTCMonth() + 1);
    }
    return out;
}

/**
 * Findet die nächste Periodengrenze, die strikt **nach** `after` liegt.
 * Iteriert ab `startedAt` (Fallback: `after`) jeweils +1 Cycle, bis das
 * Ergebnis größer als `after` ist.
 */
export function periodEndAfter(startedAt: Date | null, cycle: BillingCycle, after: Date): Date {
    let candidate = new Date(startedAt ?? after);
    // Falls `startedAt > after` (Subscription startet erst in Zukunft), ist die
    // erste Periodengrenze startedAt selbst — danach iterieren wir hoch.
    while (candidate <= after) {
        candidate = advanceOneCycle(candidate, cycle);
    }
    return candidate;
}

/**
 * Liefert das initiale Periodenfenster für eine Subscription
 * (`currentPeriodStart`/`currentPeriodEnd`). `start` ist `startedAt`,
 * `end = start + 1 Cycle`. Wir iterieren bewusst nicht — bei
 * Plan-Wechsel / Renewal-Cron-Lauf wird der Wert aktiv neu gesetzt.
 */
export function initialPeriodWindow(
    startedAt: Date,
    cycle: BillingCycle,
): { start: Date; end: Date } {
    return { start: startedAt, end: advanceOneCycle(startedAt, cycle) };
}

/**
 * Findet die früheste Periodengrenze, die **mindestens `minLeadDays` Tage**
 * in der Zukunft liegt. Wird vom Notification-Cron benutzt, um die
 * Effektiv-Periode für anstehende Versions-Wechsel zu bestimmen:
 *
 *  - `BillingCycle = YEARLY` mit `currentPeriodEnd ∈ [+42d, +43d)`: trivial,
 *    Effektiv-Datum = currentPeriodEnd.
 *  - `BillingCycle = MONTHLY` mit `currentPeriodEnd in 16d`: 16d < 42d → die
 *    Funktion springt auf die übernächste Periode (≥ 42d Vorlauf).
 *
 * Spec: ROADMAP §2 Nr. 3 (Vorwarnfrist), §6.1 (Zeitliche Auswahl).
 */
export function periodEndWithMinLead(
    startedAt: Date | null,
    cycle: BillingCycle,
    now: Date,
    minLeadDays = 42,
): Date {
    const minLeadMs = minLeadDays * 86_400_000;
    let candidate = periodEndAfter(startedAt, cycle, now);
    while (candidate.getTime() - now.getTime() < minLeadMs) {
        candidate = advanceOneCycle(candidate, cycle);
    }
    return candidate;
}
