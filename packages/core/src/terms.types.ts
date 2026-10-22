// The operator's terms as a version and a file (`SC-CFG-038`): what
// `config/saas.yaml#terms` names, archived once at the start with its
// checksum and never replaced, so a contract that records the version has its
// terms read back as they were agreed (`SC-AUD-016`).

/** What a version of the terms may be called: it stands in documents, file names and the audit log. */
export const TERMS_VERSION_PATTERN = /^[A-Za-z0-9._-]{1,32}$/;

/** The one kind of file the terms are kept as: a document every subscriber can open and keep. */
export const TERMS_MEDIA_TYPE = 'application/pdf';

/** A version of the terms on its way into the archive. */
export interface TermsVersionToArchive {
    version: string;
    /** SHA-256 of `content`, as 64 lower-case hex digits. */
    checksum: string;
    mediaType: typeof TERMS_MEDIA_TYPE;
    /** The file's own name, without the directory it was read from. */
    fileName: string;
    content: Uint8Array;
    archivedAt: Date;
}

/** A version of the terms as the archive keeps it. */
export type ArchivedTermsVersion = TermsVersionToArchive;

/** Whether `content` is a PDF, by the bytes every PDF begins with rather than by a name. */
export function isPdf(content: Uint8Array): boolean {
    const MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];
    return MAGIC.every((byte, at) => content[at] === byte);
}
