// Trial-Carry-over-Formel (#17) — generisch in der Plattform.
//
// Wechselt ein Tenant WÄHREND des Trials das Paket, wird die verbleibende
// Trialzeit übertragen:
//   Trialzeit_neu = Trialtage(Ziel) − aufgebrauchte Trialtage, min. 0
//   aufgebraucht  = Trialtage(aktuell) − Resttage; Resttage aus `currentTrialEndsAt`.
//
// Da `currentTrialEndsAt − Trialtage(aktuell)` den Trial-Start invariant
// rekonstruiert, ist die Berechnung über mehrere Wechsel driftfrei. Die
// Trial-Config (Trialtage je Plan) bleibt konsumentenseitig (z. B.
// `MarketingProjection.trialDays`) und wird über den `TrialProjectionPort`
// hereingereicht — nur die Formel ist generisch.

const MS_PER_DAY = 86_400_000;

export function computeCarriedTrialEndsAt(
    currentTrialDays: number,
    newTrialDays: number,
    currentTrialEndsAt: Date,
    now: Date,
): Date {
    const daysRemaining = Math.max(
        0,
        Math.ceil((currentTrialEndsAt.getTime() - now.getTime()) / MS_PER_DAY),
    );
    const usedDays = Math.max(0, currentTrialDays - daysRemaining);
    const newDays = Math.max(0, newTrialDays - usedDays);
    return new Date(now.getTime() + newDays * MS_PER_DAY);
}
