// Where retirement announcements are kept.

import type { NewVersionRetirement, VersionRetirementRecord } from '../version-retirement.types.js';
import type { TransactionContext } from './core-ports.types.js';

/**
 * Keeps every retirement announcement: which version, which replacement, when
 * and by whom. What it means for each subscription it reaches is kept beside it
 * as a notice of kind `version-retired`, written in the same transaction.
 */
export interface VersionRetirementRepository {
    /** Records an announcement, in the caller's transaction where one is given. */
    create(data: NewVersionRetirement, tx?: TransactionContext): Promise<VersionRetirementRecord>;
    /** Every announcement, the most recent first. */
    list(): Promise<VersionRetirementRecord[]>;
    findById(id: string): Promise<VersionRetirementRecord | null>;
}
