// The port behind the mark an installation carries in its database: which
// installation it belongs to, and whether it is a test operation.

import type { InstallationMark } from '../installation-mark.types.js';

/**
 * Keeps the one mark of the installation (`installation_marks`, a single row).
 *
 * An adapter translates. It does not decide whether a mark may be set or
 * replaced; it makes each write conditional on what stands, so that two
 * operators marking at once cannot both succeed, and a replacement does not
 * land on a mark somebody changed after the caller read it.
 */
export interface InstallationMarkPort {
    /** The mark, or `null` where nobody has marked the database yet. */
    find(): Promise<InstallationMark | null>;
    /**
     * Writes `mark` where none stands; returns what stands after the call — the
     * earlier one where one stood. Of two concurrent calls exactly one lands,
     * and both answer with the one that did.
     */
    markIfUnmarked(mark: InstallationMark): Promise<InstallationMark>;
    /**
     * Replaces the mark only while the identifier and the operation of
     * `current` are the ones that stand; returns the new mark, or `null` where
     * they no longer stand — or no mark does — and nothing was written. The
     * operation is part of the guard because an operator changing it on the
     * same identifier is told which operation the database has now, and a
     * change somebody made a moment earlier would make that answer wrong.
     */
    replace(
        current: Pick<InstallationMark, 'identifier' | 'testOperation'>,
        mark: InstallationMark,
    ): Promise<InstallationMark | null>;
}
