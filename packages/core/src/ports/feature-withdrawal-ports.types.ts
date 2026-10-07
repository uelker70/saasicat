// Where feature withdrawals are kept.

import type {
    FeatureWithdrawalLift,
    FeatureWithdrawalRecord,
    NewFeatureWithdrawal,
} from '../feature-withdrawal.types.js';
import type { TransactionContext } from './core-ports.types.js';

/**
 * Keeps every feature withdrawal: which feature, why, from when, the
 * reductions the operator named, and when it was lifted. What it means for
 * each subscription it reaches is kept beside it as a notice of kind
 * `feature-withdrawn`, written in the same transaction.
 *
 * An adapter translates. It does not decide whether a feature may be
 * withdrawn; it holds a feature to one withdrawal not yet lifted, so that two
 * operators announcing at once cannot both succeed, and makes lifting
 * conditional on the withdrawal not having been lifted.
 */
export interface FeatureWithdrawalRepository {
    /**
     * Records a withdrawal, in the caller's transaction where one is given, and
     * returns it as stored — the id is the adapter's to assign. Returns null
     * where a withdrawal of the same feature is recorded and not lifted: the
     * database holds a feature to one, so of two concurrent calls exactly one
     * lands.
     */
    create(
        data: NewFeatureWithdrawal,
        tx?: TransactionContext,
    ): Promise<FeatureWithdrawalRecord | null>;
    /** Every withdrawal, the most recently announced first. */
    list(): Promise<FeatureWithdrawalRecord[]>;
    findById(id: string): Promise<FeatureWithdrawalRecord | null>;
    /**
     * Records that the withdrawal `id` is lifted, provided it is not lifted
     * yet, and returns it as stored; null where it was lifted meanwhile or no
     * withdrawal has that id.
     */
    lift(
        id: string,
        lift: FeatureWithdrawalLift,
        tx?: TransactionContext,
    ): Promise<FeatureWithdrawalRecord | null>;
}
