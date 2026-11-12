// A tenant's full export, as the application hands it to the platform to serve
// to the tenant's administrators once its subscription has ended
// (`SC-PRIV-017`).
//
// The platform does not know what an application keeps for a tenant, so it
// does not assemble the export: it asks the application for the file and
// serves it under the tenant's session. The fields carry the names an invoice
// document carries (`InvoiceDocument`), so one download helper serves both.

/** The tenant's full export as one file. */
export interface TenantDataExport {
    /**
     * The file's bytes, or an iterable that yields them in order — a Node
     * `Readable` is one. Where it is an iterable, the platform has only its
     * start in hand when it records the download, and a stream that fails
     * partway ends a download that was recorded.
     */
    content: Uint8Array | AsyncIterable<Uint8Array>;
    /** Such as `application/json` or `application/zip`. */
    mediaType: string;
    /**
     * What a person saving it would call it, such as `acme-export-2026-11-30.json`.
     * Untrusted for the download's header: the platform keeps the characters
     * that cannot end it and replaces the rest.
     */
    fileName: string;
}
