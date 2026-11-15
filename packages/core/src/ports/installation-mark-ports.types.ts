// The port behind the mark an installation carries in its database.

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
     * Replaces the mark only while `current` is the identifier that stands;
     * returns the new mark, or `null` where `current` no longer stands — or
     * none does — and nothing was written.
     */
    replace(current: string, mark: InstallationMark): Promise<InstallationMark | null>;
}
