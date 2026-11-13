// The application's export of a tenant's data, for a test that has to wire one:
// every installation that keeps the ends of subscriptions refuses to start
// without it.

/** A `TenantDataExportPort` that hands every tenant the same small file. */
export function anExport() {
    return {
        export: async () => ({
            content: new TextEncoder().encode('{}'),
            mediaType: 'application/json',
            fileName: 'export.json',
        }),
    };
}
