// Canonical row -> record mapping for add-on retirement announcements. Pure, and
// shared by both adapters for the reason `subscription-contract-mapping.ts` gives.

import type { BundleVersionRetirementRecord } from './bundle-version-retirement.types.js';

/** A `bundle_version_retirements` row as either adapter reads it back. */
export interface CanonicalBundleVersionRetirementRow {
    id: string;
    retiredBundleVersionId: string;
    retiredBundleKey: string;
    retiredVersion: number;
    replacementBundleVersionId: string;
    replacementBundleKey: string;
    replacementVersion: number;
    announcedAt: Date;
    announcedBy: string;
}

/** Reads a row back as a record, naming each column rather than spreading the row. */
export function toBundleVersionRetirementRecord(
    row: CanonicalBundleVersionRetirementRow,
): BundleVersionRetirementRecord {
    return {
        id: row.id,
        retired: {
            bundleVersionId: row.retiredBundleVersionId,
            bundleKey: row.retiredBundleKey,
            version: row.retiredVersion,
        },
        replacement: {
            bundleVersionId: row.replacementBundleVersionId,
            bundleKey: row.replacementBundleKey,
            version: row.replacementVersion,
        },
        announcedAt: row.announcedAt,
        announcedBy: row.announcedBy,
    };
}
