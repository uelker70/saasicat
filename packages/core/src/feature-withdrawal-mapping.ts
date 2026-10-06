// Canonical row -> record mapping for feature withdrawals. Pure, and shared by
// both adapters for the reason `subscription-contract-mapping.ts` gives.

import { oneOf } from './closed-value.js';
import type {
    FeatureWithdrawalLineKind,
    FeatureWithdrawalRecord,
    FeatureWithdrawalReduction,
} from './feature-withdrawal.types.js';
import type { BillingCycle } from './promo-code.types.js';

const TABLE = 'feature_withdrawals';

// Keyed rather than listed, so that a value added to either type fails to
// compile here until it is read as well.
const KINDS: Record<FeatureWithdrawalLineKind, true> = { plan: true, bundle: true };
const CYCLES: Record<BillingCycle, true> = { MONTHLY: true, YEARLY: true };

/**
 * A `feature_withdrawals` row as either adapter reads it back. `reductions` is
 * `unknown`: the database holds whatever was written to the column.
 */
export interface CanonicalFeatureWithdrawalRow {
    id: string;
    featureKey: string;
    reason: string;
    effectiveFrom: Date;
    liftedFrom: Date | null;
    reductions: unknown;
    announcedAt: Date;
    announcedBy: string;
    liftedAt: Date | null;
    liftedBy: string | null;
}

/**
 * Reads a row back as a record, naming each column rather than spreading the
 * row. The reductions are checked rather than cast: they are what every
 * subscription the withdrawal reached is charged less by, and a value nobody
 * can read must stop at the read and name its row.
 */
export function toFeatureWithdrawalRecord(
    row: CanonicalFeatureWithdrawalRow,
): FeatureWithdrawalRecord {
    return {
        id: row.id,
        featureKey: row.featureKey,
        reason: row.reason,
        effectiveFrom: row.effectiveFrom,
        liftedFrom: row.liftedFrom,
        reductions: reductionsOf(row),
        announcedAt: row.announcedAt,
        announcedBy: row.announcedBy,
        liftedAt: row.liftedAt,
        liftedBy: row.liftedBy,
    };
}

function reductionsOf(row: CanonicalFeatureWithdrawalRow): FeatureWithdrawalReduction[] {
    if (!Array.isArray(row.reductions)) {
        throw new Error(`${TABLE} row '${row.id}' holds reductions that are not a list.`);
    }
    return row.reductions.map((entry: unknown, index) => {
        const column = `reductions[${index}]`;
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new Error(`${TABLE} row '${row.id}' holds ${column} that is not an object.`);
        }
        const { kind, key, billingCycle, amountNet } = entry as Record<string, unknown>;
        if (
            typeof kind !== 'string' ||
            typeof key !== 'string' ||
            typeof billingCycle !== 'string' ||
            typeof amountNet !== 'number' ||
            !Number.isFinite(amountNet)
        ) {
            throw new Error(
                `${TABLE} row '${row.id}' holds ${column} without a kind, a key, a billing ` +
                    'cycle and a finite amount.',
            );
        }
        const source = { table: TABLE, id: row.id };
        return {
            kind: oneOf(Object.keys(KINDS) as FeatureWithdrawalLineKind[], kind, {
                ...source,
                column: `${column}.kind`,
            }),
            key,
            billingCycle: oneOf(Object.keys(CYCLES) as BillingCycle[], billingCycle, {
                ...source,
                column: `${column}.billingCycle`,
            }),
            amountNet,
        };
    });
}
