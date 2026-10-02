// Canonical row -> record mapping for retirement announcements. Pure, and shared
// by both adapters for the reason `subscription-contract-mapping.ts` gives.

import type { VersionRetirementRecord } from './version-retirement.types.js';

/** A `version_retirements` row as either adapter reads it back. */
export interface CanonicalVersionRetirementRow {
    id: string;
    retiredPlanVersionId: string;
    retiredPlanKey: string;
    retiredVersion: number;
    replacementPlanVersionId: string;
    replacementPlanKey: string;
    replacementVersion: number;
    announcedAt: Date;
    announcedBy: string;
}

/** Reads a row back as a record, naming each column rather than spreading the row. */
export function toVersionRetirementRecord(
    row: CanonicalVersionRetirementRow,
): VersionRetirementRecord {
    return {
        id: row.id,
        retired: {
            planVersionId: row.retiredPlanVersionId,
            planKey: row.retiredPlanKey,
            version: row.retiredVersion,
        },
        replacement: {
            planVersionId: row.replacementPlanVersionId,
            planKey: row.replacementPlanKey,
            version: row.replacementVersion,
        },
        announcedAt: row.announcedAt,
        announcedBy: row.announcedBy,
    };
}
