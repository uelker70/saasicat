import { startOfUtcDay } from '@saasicat/core';
import { and, desc, gt, gte, isNotNull, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { planVersions } from './schema.js';

/**
 * The versions on sale at `asOf`: published, begun, not past their last day,
 * not ended, and — once superseded — only within a last day they carry:
 * `buildActivePlanVersionWhere(asOf, { withEndsAt: true })` in Drizzle terms,
 * which says why the last clause is there. The repository, the catalogue read and the entitlement
 * read all filter with it, so they cannot name different versions.
 *
 * `validUntil` is day-inclusive — a window that closes on the 28th is still
 * open at 23:59 on the 28th — which is why the comparison is against
 * `startOfUtcDay(asOf)`. The writing half of the rule is `previousUtcDay` in
 * the publish; both come from `@saasicat/core`.
 */
export function onSaleAt(asOf: Date): SQL {
    return and(
        sql`${planVersions.publishedAt} IS NOT NULL`,
        or(isNull(planVersions.validFrom), lte(planVersions.validFrom, asOf)),
        or(isNull(planVersions.validUntil), gte(planVersions.validUntil, startOfUtcDay(asOf))),
        or(isNull(planVersions.endsAt), gt(planVersions.endsAt, asOf)),
        or(isNull(planVersions.supersededAt), isNotNull(planVersions.validUntil)),
    )!;
}

/**
 * Which of several versions on sale wins: the latest start, a version without
 * one last, then the highest number — the order adapter-prisma uses.
 */
export const ON_SALE_ORDER = [
    sql`${planVersions.validFrom} DESC NULLS LAST`,
    desc(planVersions.version),
];
