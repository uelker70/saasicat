// Geteilte Proration-Rechnung für Self-Service-Previews (#37).
//
// Plan-Wechsel (PlanChangePreviewService) und Bundle-Add
// (SubscriptionBundlePreviewService) rechnen mit derselben Formel:
// anteiliger Mehr-/Minderbetrag = (Zielpreis − aktueller Preis) ×
// Resttage / Periodentage. Tages-Granularität, kaufmännisch auf 2
// Nachkommastellen gerundet.

const DAY_MS = 86_400_000;

export interface ProrationDto {
    daysRemainingInPeriod: number;
    daysInPeriod: number;
    periodStart: Date;
    periodEnd: Date;
    currentPriceNet: number;
    targetPriceNet: number;
    /** Anteiliger Mehr-/Minderbetrag bis Periodenende. Negativ = Gutschrift. */
    prorataDeltaNet: number;
}

export interface ProrationInput {
    periodStart: Date;
    periodEnd: Date;
    now: Date;
    /** Bisheriger Periodenpreis (Bundle-Add: 0 — es kommt nur etwas hinzu). */
    currentPriceNet: number;
    targetPriceNet: number;
}

export function computeProration(input: ProrationInput): ProrationDto {
    const { periodStart, periodEnd, now, currentPriceNet, targetPriceNet } = input;

    const daysInPeriod = Math.max(
        1,
        Math.round((periodEnd.getTime() - periodStart.getTime()) / DAY_MS),
    );
    const daysRemaining = Math.max(
        0,
        Math.min(daysInPeriod, Math.round((periodEnd.getTime() - now.getTime()) / DAY_MS)),
    );
    const prorataDeltaNet = round2(
        ((targetPriceNet - currentPriceNet) * daysRemaining) / daysInPeriod,
    );

    return {
        daysRemainingInPeriod: daysRemaining,
        daysInPeriod,
        periodStart,
        periodEnd,
        currentPriceNet,
        targetPriceNet,
        prorataDeltaNet,
    };
}

// Lokal statt aus ../promo importiert: die Sub-Entries (billing/promo)
// bundeln getrennt — ein Cross-Entry-Import würde das Promo-Modul in den
// Billing-Chunk duplizieren.
function round2(n: number): number {
    return Math.round(n * 100) / 100;
}
