// Where add-on retirement announcements are kept.

import type {
    BundleVersionRetirementRecord,
    NewBundleVersionRetirement,
} from '../bundle-version-retirement.types.js';
import type { TransactionContext } from './core-ports.types.js';

/**
 * Keeps every add-on retirement announcement: which version, which
 * replacement, when and by whom. What it means for each booking it reaches is
 * kept beside it as a notice of kind `bundle-version-retired`, written in the
 * same transaction.
 */
export interface BundleVersionRetirementRepository {
    /** Records an announcement, in the caller's transaction where one is given. */
    create(
        data: NewBundleVersionRetirement,
        tx?: TransactionContext,
    ): Promise<BundleVersionRetirementRecord>;
    /** Every announcement, the most recent first. */
    list(): Promise<BundleVersionRetirementRecord[]>;
    findById(id: string): Promise<BundleVersionRetirementRecord | null>;
}
