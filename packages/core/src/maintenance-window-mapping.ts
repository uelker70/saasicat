// Canonical row -> record mapping for maintenance windows. Pure, and shared by
// both adapters for the reason `subscription-contract-mapping.ts` gives.

import type { MaintenanceWindowRecord } from './maintenance-window.types.js';

/** A `maintenance_windows` row as either adapter reads it back. */
export type CanonicalMaintenanceWindowRow = MaintenanceWindowRecord;

/**
 * Reads a row back as a record, naming each column rather than spreading the
 * row: a column a later release adds is not handed to the platform by accident,
 * and a version reading the table a later release extended reads what it knows.
 */
export function toMaintenanceWindowRecord(
    row: CanonicalMaintenanceWindowRow,
): MaintenanceWindowRecord {
    return {
        id: row.id,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        message: row.message,
        createdAt: row.createdAt,
        createdBy: row.createdBy,
        lockedAt: row.lockedAt,
        lockedBy: row.lockedBy,
        endedAt: row.endedAt,
        endedBy: row.endedBy,
    };
}
