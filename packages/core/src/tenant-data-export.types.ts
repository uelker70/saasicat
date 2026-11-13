// A tenant's full export, as the application hands it to the platform to serve
// to the tenant's administrators once its subscription has ended
// (`SC-PRIV-019`).
//
// The platform does not know what an application keeps for a tenant, so it
// does not assemble the export: it asks the application for the file and
// serves it under the tenant's session. The fields carry the names an invoice
// document carries (`InvoiceDocument`), so one download helper serves both.

/** The tenant's full export as one file. */
export interface TenantDataExport {
    /**
     * The whole file, already produced, at least one byte of it. Bytes rather
     * than a stream: the download is recorded before the file is sent, and only
     * a file the application has finished producing can be recorded as handed
     * over. A very large export is therefore held in memory once while it is
     * served. An empty one is refused as an export the application did not
     * produce.
     */
    content: Uint8Array;
    /**
     * Such as `application/json` or `application/zip`: printable ASCII, since
     * it goes into the download's header as it is. Any other is refused as an
     * export the application did not produce.
     */
    mediaType: string;
    /**
     * What a person saving it would call it, such as `acme-export-2026-11-30.json`.
     * Untrusted for the download's header: the platform keeps the characters
     * that cannot end it and replaces the rest.
     */
    fileName: string;
}
