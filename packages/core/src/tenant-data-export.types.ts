// A tenant's full export, which its administrators take once its subscription
// has ended (`SC-PRIV-020`), and the two ways it reaches them.
//
// The platform does not know what an application keeps for a tenant, so it
// does not assemble the export. Either the application hands the file over and
// the platform serves it under the tenant's session (`TenantDataExport`), or
// the application delivers it from a download of its own and tells the
// platform once it has gone out in full (`DeliveredTenantExport`). Both leave
// the same record of the download. The fields of a file handed over carry the
// names an invoice document carries (`InvoiceDocument`), so one download
// helper serves both.

/**
 * Who delivers a tenant's full export to its administrator: `'platform'` from
 * `GET billing/export`, out of the file `TenantDataExportPort` hands over, or
 * `'application'` from a download of the application's own.
 */
export type TenantExportDeliverer = 'platform' | 'application';

/**
 * Declares that the application delivers the tenant's full export itself, in
 * place of a `TenantDataExportPort`: from a download of its own, which may
 * stream a file too large to hold in memory, and which records each download
 * with the platform once it has gone out in full.
 */
export interface TenantExportDeliveredByTheApplication {
    deliveredBy: 'application';
}

/**
 * What the application says of an export it delivered itself, once the whole
 * file has gone out: what the record and the audit log keep of it.
 */
export interface DeliveredTenantExport {
    /** The bytes that went out, a whole number of at least 1: an empty export is no export. */
    size: number;
    /**
     * Such as `application/zip`: printable ASCII, as for a file the platform
     * serves, so the audit log reads both alike.
     */
    mediaType: string;
}

/** The tenant's full export as one file. */
export interface TenantDataExport {
    /**
     * The whole file, already produced, at least one byte of it. Bytes rather
     * than a stream: the download is recorded before the file is sent, and only
     * a file the application has finished producing can be recorded as handed
     * over. A very large export is therefore held in memory once while it is
     * served — one per tenant at a time within a process, a second request
     * meanwhile being refused (`TENANT_EXPORT_IN_PROGRESS`). An export too
     * large for that is delivered by the application itself
     * (`TenantExportDeliveredByTheApplication`). An empty one is refused as an
     * export the application did not produce.
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
