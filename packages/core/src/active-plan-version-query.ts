// Active-PlanVersion WHERE builder — pure function, NestJS-/Prisma-free.
//
// Single source of truth for the time window of the PlanVersion active at
// `asOf`. Consumed by the Prisma adapters of all consumer
// apps (Plan and PlanVersion repository), which spread the result next to
// their `planId` filter in `findFirst({ where })`.
//
// validFrom tolerance: `validFrom IS NULL` is treated as "valid since forever".
// Legacy data without a start date (published before the §4.2 publish
// requirement was introduced) therefore does not drop out of the catalog. In
// PostgreSQL sorts NULL first for descending order by default. Callers must
// request `NULLS LAST` explicitly so legacy rows remain a fallback behind
// dated versions instead of overriding them.
//
// validUntil day semantics: `validFrom`/`validUntil` are stored as day dates
// (UTC midnight from 'YYYY-MM-DD') and are valid **inclusive of their day**
// (spec §4.2 + auto-succession `validUntil = successor.validFrom
// − 1 day`). Since `asOf` carries the live time of day, `validUntil` is
// compared against the start of day of `asOf` (`>= startOfUtcDay(asOf)`), not
// `> asOf` — otherwise a version would already be dark on its own last day.
//
// A superseded version stays on sale only within a last day it carries. Every
// publish closes its predecessor's window, but a catalogue import supersedes
// without one, and so did every publish on an installation that did not keep
// the dates. Such a version has nothing that would ever end its window: let
// through, it would be on sale again the moment its successor ends, at its
// old price. So "superseded" counts wherever no `validUntil` says otherwise.
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

/**
 * The day before `value` — how a validity window closes when its successor
 * opens (`validUntil = successor.validFrom − 1 day`, the rule this module's
 * header states and `startOfUtcDay` above is the reading half of).
 *
 * It lived as three separate expressions before 2026-08-27: one in each
 * adapter's publish path and one in the bundle repository, all agreeing by
 * coincidence rather than by construction. Day arithmetic rather than
 * `− 24 * 60 * 60 * 1000`: the subtraction is only equivalent while the value
 * is a UTC midnight, and nothing in the type says it is.
 */
export function previousUtcDay(value: Date): Date {
    const result = new Date(value);
    result.setUTCDate(result.getUTCDate() - 1);
    return result;
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

/** `OR` block of the validity window; exactly one field per variant. */
type ValidityWindowClause =
    | { validFrom: DateAtOrBefore | null }
    | { validUntil: DateAtOrAfter | null }
    | { supersededAt: null }
    | { validUntil: { not: null } };

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
 *   `(supersededAt IS NULL OR validUntil IS NOT NULL)`  // superseded: only with a last day
 *   with `withEndsAt`: additionally `(endsAt IS NULL OR endsAt > asOf)`.  // precise
 *
 * `planId` stays with the caller (repo-specific type). Matching Prisma
 * `orderBy` for PostgreSQL:
 * `[{ validFrom: { sort: 'desc', nulls: 'last' } }, { version: 'desc' }]`.
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
        { OR: [{ supersededAt: null }, { validUntil: { not: null } }] },
    ];
    if (!options.withEndsAt) {
        return { publishedAt: { not: null }, AND: validityWindow };
    }
    return {
        publishedAt: { not: null },
        AND: [...validityWindow, { OR: [{ endsAt: null }, { endsAt: { gt: asOf } }] }],
    };
}

/**
 * Model-neutral name for {@link ActivePlanVersionWhere}. Bundle- and
 * PlanVersion repositories share the same published validity-window rules.
 */
export type ActiveVersionWhere = ActivePlanVersionWhere;

/** Model-neutral counterpart that additionally checks an `endsAt` timestamp. */
export type ActiveVersionWhereWithEndsAt = ActivePlanVersionWhereWithEndsAt;

/** The dates of a version that decide whether it takes bookings, as a row carries them. */
export interface VersionWindow {
    validFrom?: string | Date | null;
    validUntil?: string | Date | null;
    endsAt?: string | Date | null;
    supersededAt?: string | Date | null;
}

/**
 * Whether a version that is published takes bookings at `asOf` — the same
 * window {@link buildActivePlanVersionWhere} asks the database for, for a row
 * already read: `validFrom` at or before `asOf`, `validUntil` not before the
 * day of `asOf`, `endsAt` after `asOf`, and a superseded version only within
 * a last day it carries. A date that is absent does not close the window.
 * Whether the row is published is the caller's to know.
 */
export function isVersionActiveAt(version: VersionWindow, asOf: Date): boolean {
    const at = (value: string | Date | null | undefined): Date | null =>
        value === null || value === undefined ? null : new Date(value);
    const validFrom = at(version.validFrom);
    const validUntil = at(version.validUntil);
    const endsAt = at(version.endsAt);
    if (validFrom && validFrom > asOf) return false;
    if (validUntil && validUntil < startOfUtcDay(asOf)) return false;
    if (version.supersededAt && !validUntil) return false;
    return !(endsAt && endsAt <= asOf);
}

/**
 * Model-neutral alias for {@link buildActivePlanVersionWhere}. The original
 * export remains available for backwards compatibility.
 */
export const buildActiveVersionWhere: typeof buildActivePlanVersionWhere =
    buildActivePlanVersionWhere;
