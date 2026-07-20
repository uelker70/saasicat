// Active-PlanVersion WHERE builder — pure function, NestJS-/Prisma-free.
//
// Single source of truth for the time window of the PlanVersion active at
// `asOf` (SPEC_V2 §4.2). Consumed by the Prisma adapters of all consumer
// apps (Plan and PlanVersion repository), which spread the result next to
// their `planId` filter in `findFirst({ where })`.
//
// validFrom tolerance: `validFrom IS NULL` is treated as "valid since forever".
// Legacy data without a start date (published before the §4.2 publish
// requirement was introduced) therefore does not drop out of the catalog. In
// `orderBy [validFrom desc]` NULL sorts last — a genuine fallback behind dated
// versions, not an override.
//
// validUntil day semantics: `validFrom`/`validUntil` are stored as day dates
// (UTC midnight from 'YYYY-MM-DD') and are valid **inclusive of their day**
// (spec §4.2 + auto-succession `validUntil = successor.validFrom
// − 1 day`). Since `asOf` carries the live time of day, `validUntil` is
// compared against the start of day of `asOf` (`>= startOfUtcDay(asOf)`), not
// `> asOf` — otherwise a version would already be dark on its own last day.
//
// `withEndsAt` is typed separately: the `endsAt` clause only appears in the
// return type when a model has the column (e.g. `PlanVersion`). Models without
// `endsAt` (e.g. `CatalogPlanVersion`) must not have the variant in the type,
// otherwise TypeScript's "weak type" rule kicks in.
// `endsAt` is a precise admin termination (timestamp) → stays `> asOf`.

/** Start of day (00:00 UTC) of the moment — for day-inclusive date comparisons. */
export function startOfUtcDay(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** `<=` upper bound for a date (structurally Prisma-compatible). */
interface DateAtOrBefore {
    lte: Date;
}

/** `>=` lower bound (day-inclusive) for a date (structurally Prisma-compatible). */
interface DateAtOrAfter {
    gte: Date;
}

/** `>` upper bound (exclusive, timestamp) for a date. */
interface DateAfter {
    gt: Date;
}

/** `OR` block of the validity window; exactly one date field per variant. */
type ValidityWindowClause =
    | { validFrom: DateAtOrBefore | null }
    | { validUntil: DateAtOrAfter | null };

/** Optional `OR` block for models with `endsAt` (precise admin termination). */
type EndsAtClause = { endsAt: DateAfter | null };

/**
 * Structural counterpart to the `*PlanVersionWhereInput` excerpt for models
 * without `endsAt` (e.g. `CatalogPlanVersion`).
 */
export interface ActivePlanVersionWhere {
    publishedAt: { not: null };
    AND: Array<{ OR: ValidityWindowClause[] }>;
}

/** Like {@link ActivePlanVersionWhere}, additionally with `endsAt` clause. */
export interface ActivePlanVersionWhereWithEndsAt {
    publishedAt: { not: null };
    AND: Array<{ OR: Array<ValidityWindowClause | EndsAtClause> }>;
}

/**
 * Builds the time-window WHERE for the PlanVersion active at `asOf`:
 *   `publishedAt IS NOT NULL`
 *   `(validFrom IS NULL OR validFrom <= asOf)`
 *   `(validUntil IS NULL OR validUntil >= startOfUtcDay(asOf))`  // day-inclusive
 *   with `withEndsAt`: additionally `(endsAt IS NULL OR endsAt > asOf)`.  // precise
 *
 * `planId` stays with the caller (repo-specific type). Matching `orderBy`:
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
