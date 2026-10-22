// Canonical row -> record mapping for the archived versions of the terms, the
// triggers that keep them, and the refusal of a changed file. Pure, and shared
// by both adapters.

import { SETTINGS_ERROR_CODES } from './error-codes.js';
import { PersistenceRefusal } from './errors.js';
import { isInvoiceDocumentChecksum } from './invoice-document-mapping.js';
import { TERMS_MEDIA_TYPE, type ArchivedTermsVersion } from './terms.types.js';

const ARCHIVE = 'terms_versions';

/** A `terms_versions` row as either adapter reads it back. */
export interface CanonicalTermsVersionRow {
    version: string;
    checksum: string;
    mediaType: string;
    fileName: string;
    content: Uint8Array;
    archivedAt: Date;
}

export function toArchivedTermsVersion(row: CanonicalTermsVersionRow): ArchivedTermsVersion {
    if (!isInvoiceDocumentChecksum(row.checksum)) {
        throw new Error(`${ARCHIVE}.checksum of ${row.version} is not a SHA-256 digest.`);
    }
    if (row.mediaType !== TERMS_MEDIA_TYPE) {
        throw new Error(`${ARCHIVE}.mediaType of ${row.version} is ${row.mediaType}, not a PDF.`);
    }
    if (!(row.content instanceof Uint8Array)) {
        throw new Error(`${ARCHIVE}.content of ${row.version} is not a file.`);
    }
    return {
        version: row.version,
        checksum: row.checksum,
        mediaType: TERMS_MEDIA_TYPE,
        fileName: row.fileName,
        // A copy that owns its bytes: a driver's `Buffer` may be a view into a
        // pooled allocation, and a caller handing it on must not see that pool.
        content: new Uint8Array(row.content),
        archivedAt: row.archivedAt,
    };
}

/**
 * The triggers of `terms_versions` that keep a version as it was archived
 * (`1.0-the-terms-are-a-version-and-a-file.postgres.sql`): one refuses every
 * update and delete of a row, the other every truncate of the table.
 */
export const TERMS_ARCHIVE_TRIGGERS = [
    'terms_versions_are_kept',
    'terms_versions_are_not_emptied',
] as const;

/**
 * Why the database archive would let a version of the terms be changed, given
 * the triggers that fire on its table, or `null` where both of its own do.
 */
export function termsArchiveProtectionProblem(enabledTriggers: readonly string[]): string | null {
    const missing = TERMS_ARCHIVE_TRIGGERS.filter((name) => !enabledTriggers.includes(name));
    if (missing.length === 0) return null;
    return (
        `${ARCHIVE} lacks ${missing.join(' and ')}, which keep an archived version of the terms ` +
        'as it was agreed: run @saasicat/spec/sql/1.0-the-terms-are-a-version-and-a-file.postgres.sql, ' +
        'and enable the triggers where they were disabled.'
    );
}

/**
 * A file under a version of the terms already archived with another one,
 * refused: the first stays, since contracts concluded under the version name
 * that file. A changed file is a new version.
 */
export function termsVersionChanged(
    version: string,
    recorded: string,
    given: string,
): PersistenceRefusal {
    return new PersistenceRefusal(
        SETTINGS_ERROR_CODES.TERMS_VERSION_CHANGED,
        'moved',
        `Version '${version}' of the terms was archived with another file.`,
        { version, recorded, given },
    );
}
