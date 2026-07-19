// Aktive-PlanVersion-WHERE-Builder — Pure Function, NestJS-/Prisma-frei.
//
// Single Source of Truth für das Zeitfenster der zu `asOf` aktiven
// PlanVersion (SPEC_V2 §4.2). Wird von allen Prisma-Adaptern
// (autohauspro/vereinsfux, Plan- und PlanVersion-Repository) konsumiert, die
// das Ergebnis neben ihren `planId`-Filter in `findFirst({ where })` spreizen.
//
// validFrom-Toleranz: `validFrom IS NULL` wird wie „gilt seit jeher" behandelt.
// Altdaten ohne Startdatum (publiziert vor Einführung der §4.2-Publish-Pflicht)
// fallen damit nicht aus dem Katalog. Im `orderBy [validFrom desc]` sortiert
// NULL zuletzt — echter Fallback hinter datierten Versionen, kein Override.
//
// validUntil-Tagessemantik: `validFrom`/`validUntil` werden als Tagesdaten
// (UTC-Mitternacht aus 'YYYY-MM-DD') gespeichert und sind **inklusive ihres
// Tages** gültig (Spec §4.2 + Auto-Sukzession `validUntil = nachfolger.validFrom
// − 1 Tag`). Da `asOf` die Live-Uhrzeit trägt, wird `validUntil` gegen den
// Tagesbeginn von `asOf` verglichen (`>= startOfUtcDay(asOf)`), nicht `> asOf`
// — sonst wäre eine Version an ihrem eigenen letzten Tag bereits dunkel.
//
// `withEndsAt` ist getrennt typisiert: die `endsAt`-Klausel taucht nur im
// Rückgabetyp auf, wenn ein Modell die Spalte hat (vereinsfux `PlanVersion`).
// autohauspros `CatalogPlanVersion` kennt kein `endsAt` mehr — die Variante darf
// dort nicht im Typ stehen, sonst greift TypeScripts „weak type"-Regel.
// `endsAt` ist eine präzise Admin-Terminierung (Zeitstempel) → bleibt `> asOf`.

/** Tagesbeginn (00:00 UTC) des Zeitpunkts — für tag-inklusive Datumsvergleiche. */
export function startOfUtcDay(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** `<=`-Obergrenze für ein Datum (strukturell Prisma-kompatibel). */
interface DateAtOrBefore {
    lte: Date;
}

/** `>=`-Untergrenze (tag-inklusiv) für ein Datum (strukturell Prisma-kompatibel). */
interface DateAtOrAfter {
    gte: Date;
}

/** `>`-Obergrenze (exklusiv, Zeitstempel) für ein Datum. */
interface DateAfter {
    gt: Date;
}

/** `OR`-Block des Gültigkeitsfensters; genau ein Datumsfeld pro Variante. */
type ValidityWindowClause =
    | { validFrom: DateAtOrBefore | null }
    | { validUntil: DateAtOrAfter | null };

/** Optionaler `OR`-Block für Modelle mit `endsAt` (präzise Admin-Terminierung). */
type EndsAtClause = { endsAt: DateAfter | null };

/**
 * Strukturelles Pendant zu dem `*PlanVersionWhereInput`-Ausschnitt für Modelle
 * ohne `endsAt` (autohauspro `CatalogPlanVersion`).
 */
export interface ActivePlanVersionWhere {
    publishedAt: { not: null };
    AND: Array<{ OR: ValidityWindowClause[] }>;
}

/** Wie {@link ActivePlanVersionWhere}, zusätzlich mit `endsAt`-Klausel. */
export interface ActivePlanVersionWhereWithEndsAt {
    publishedAt: { not: null };
    AND: Array<{ OR: Array<ValidityWindowClause | EndsAtClause> }>;
}

/**
 * Baut die Zeitfenster-WHERE für die zu `asOf` aktive PlanVersion:
 *   `publishedAt IS NOT NULL`
 *   `(validFrom IS NULL OR validFrom <= asOf)`
 *   `(validUntil IS NULL OR validUntil >= startOfUtcDay(asOf))`  // tag-inklusiv
 *   mit `withEndsAt`: zusätzlich `(endsAt IS NULL OR endsAt > asOf)`.  // präzise
 *
 * `planId` bleibt beim Aufrufer (Repo-spezifischer Typ). Passendes `orderBy`:
 * `[{ validFrom: 'desc' }, { version: 'desc' }]`.
 */
export function buildActivePlanVersionWhere(
    asOf: Date,
    options?: { withEndsAt?: false },
): ActivePlanVersionWhere;
export function buildActivePlanVersionWhere(
    asOf: Date,
    options: { withEndsAt: true },
): ActivePlanVersionWhereWithEndsAt;
export function buildActivePlanVersionWhere(
    asOf: Date,
    options: { withEndsAt?: boolean } = {},
): ActivePlanVersionWhere | ActivePlanVersionWhereWithEndsAt {
    const asOfDayStart = startOfUtcDay(asOf);
    const validityWindow: Array<{ OR: ValidityWindowClause[] }> = [
        { OR: [{ validFrom: null }, { validFrom: { lte: asOf } }] },
        { OR: [{ validUntil: null }, { validUntil: { gte: asOfDayStart } }] },
    ];
    if (!options.withEndsAt) {
        return { publishedAt: { not: null }, AND: validityWindow };
    }
    return {
        publishedAt: { not: null },
        AND: [...validityWindow, { OR: [{ endsAt: null }, { endsAt: { gt: asOf } }] }],
    };
}
