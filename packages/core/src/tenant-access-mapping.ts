// Canonical row -> reason mapping for tenant access holds. Pure, and shared by
// both adapters for the reason `subscription-contract-mapping.ts` gives.

import type { TenantAccessHold, TenantAccessHoldKind } from './tenant-access.types.js';

/** A `tenant_access_holds` row as either adapter reads it back: `kind` is whatever the column holds. */
export type CanonicalTenantAccessHoldRow = Omit<TenantAccessHold, 'kind'> & { kind: string };

const KINDS: ReadonlySet<string> = new Set<TenantAccessHoldKind>([
    'suspended',
    'overdue',
    'ended',
    'deleting',
]);

function isKind(value: string): value is TenantAccessHoldKind {
    return KINDS.has(value);
}

/**
 * Reads a row back as a reason, naming each column rather than spreading the
 * row. A kind the platform does not know is refused rather than read as some
 * other kind: the table's check holds it to the four, so a row that escapes it
 * was written past the platform, and guessing what it restricts would be
 * guessing a tenant's access.
 */
export function toTenantAccessHold(row: CanonicalTenantAccessHoldRow): TenantAccessHold {
    if (!isKind(row.kind)) {
        throw new Error(
            `tenant_access_holds row ${row.id} has kind '${row.kind}', which is none of ` +
                `${[...KINDS].join(', ')}.`,
        );
    }
    return {
        id: row.id,
        tenantId: row.tenantId,
        kind: row.kind,
        reference: row.reference,
        note: row.note,
        since: row.since,
        recordedBy: row.recordedBy,
        liftedAt: row.liftedAt,
        liftedBy: row.liftedBy,
    };
}
