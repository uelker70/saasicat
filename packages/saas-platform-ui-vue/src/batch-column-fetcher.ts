// BatchColumnFetcher — loads custom TenantColumn data in ONE request per
// column (required by SPEC §4.6: no N+1 for the tenant page table).
//
// Manifest contract: every `TenantColumnDef.endpoint` MUST be batch-capable —
// no `{slug}` or `{tenantId}` placeholder in the path. The fetcher appends
// `?tenantIds=t1,t2,...,tN` (or `tenantIds=t1&tenantIds=t2&...` — the
// `paramStyle` option picks the format) and expects a response of the form
// `Record<tenantId, value>`.
//
// Capability filter: columns without a satisfied `requiredCapability` are not
// fetched at all. Manifest drift (a column `endpoint` with a `{slug}` pattern)
// is reported in a structured way via `BatchColumnDriftError` — the consumer
// shell then renders a warning.

import type { AdminManifest, TenantColumnDef } from '@saasicat/types';
import { defaultHttpClient, type HttpClient } from './types.js';

export type BatchColumnValue = unknown;

/** One value per `tenantId` (freely structured). */
export type BatchColumnRow = Record<string, BatchColumnValue>;

/** One `tenantId → value` map per column key. */
export type BatchColumnData = Record<string, BatchColumnRow>;

export type ParamStyle = 'comma' | 'repeat';

export interface BatchColumnFetcherOptions {
    http?: HttpClient;
    /**
     * How the `tenantIds` are passed to the endpoint. Default `'comma'` →
     * `?tenantIds=t1,t2,t3`. `'repeat'` → `?tenantIds=t1&tenantIds=t2`.
     * Consumer backends decide based on their framework (NestJS accepts
     * comma-separated strings by default, or via `@Query() ids: string[]`).
     */
    paramStyle?: ParamStyle;
    /**
     * Auth-token provider for `Authorization: Bearer <token>`. The consumer
     * supplies a function that pulls the current token from the auth store.
     */
    getAuthToken?: () => string | null;
}

export class BatchColumnDriftError extends Error {
    constructor(
        public readonly column: TenantColumnDef,
        reason: string,
    ) {
        super(`Spalte "${column.key}": ${reason}`);
        this.name = 'BatchColumnDriftError';
    }
}

export class BatchColumnFetcher {
    private readonly http: HttpClient;
    private readonly paramStyle: ParamStyle;
    private readonly getAuthToken?: () => string | null;

    constructor(options: BatchColumnFetcherOptions = {}) {
        this.http = options.http ?? defaultHttpClient();
        this.paramStyle = options.paramStyle ?? 'comma';
        this.getAuthToken = options.getAuthToken;
    }

    /**
     * Loads the data for all columns declared in the manifest in parallel
     * (one request per column, all `tenantIds` in the batch). Columns without
     * a satisfied capability are ignored.
     */
    async fetchAll(manifest: AdminManifest, tenantIds: string[]): Promise<BatchColumnData> {
        if (tenantIds.length === 0) return {};
        const cols = this.eligibleColumns(manifest);
        const results = await Promise.all(
            cols.map((col) =>
                this.fetchOne(col, tenantIds).then((data) => [col.key, data] as const),
            ),
        );
        const out: BatchColumnData = {};
        for (const [key, data] of results) out[key] = data;
        return out;
    }

    /** Fetch a single column (consumers may also use this directly). */
    async fetchOne(column: TenantColumnDef, tenantIds: string[]): Promise<BatchColumnRow> {
        this.validateBatchEndpoint(column);
        if (tenantIds.length === 0) return {};
        const url = this.buildUrl(column.endpoint, tenantIds);
        const headers: Record<string, string> = {};
        const token = this.getAuthToken?.();
        if (token) headers.Authorization = `Bearer ${token}`;
        const res = await this.http(url, { method: 'GET', headers });
        if (res.status !== 200) {
            throw new Error(
                `Spalte "${column.key}" — Endpoint ${column.endpoint} antwortete HTTP ${res.status}`,
            );
        }
        const body = (await res.json()) as BatchColumnRow;
        return body;
    }

    /**
     * Column drift against the manifest. Consumers use this for CI smoke
     * tests of the manifest-vs-shell build.
     */
    listDriftIssues(manifest: AdminManifest): BatchColumnDriftError[] {
        const issues: BatchColumnDriftError[] = [];
        for (const col of manifest.tenants?.columns ?? []) {
            try {
                this.validateBatchEndpoint(col);
            } catch (err) {
                if (err instanceof BatchColumnDriftError) issues.push(err);
            }
        }
        return issues;
    }

    /**
     * Which columns have a satisfied `requiredCapability`? Manifest =
     * discovery, so a local check is enough.
     */
    eligibleColumns(manifest: AdminManifest): TenantColumnDef[] {
        const caps = manifest.capabilities ?? {};
        return (manifest.tenants?.columns ?? []).filter((col) => {
            if (!col.requiredCapability) return true;
            return caps[col.requiredCapability] === true;
        });
    }

    private validateBatchEndpoint(col: TenantColumnDef): void {
        if (!col.endpoint || col.endpoint.trim().length === 0) {
            throw new BatchColumnDriftError(col, 'endpoint ist leer');
        }
        if (col.endpoint.includes('{slug}') || col.endpoint.includes('{tenantId}')) {
            throw new BatchColumnDriftError(
                col,
                'endpoint enthält per-Tenant-Placeholder ({slug}/{tenantId}). ' +
                    'Spalten-Endpoints müssen batchfähig sein — bitte Backend ' +
                    'auf `?tenantIds=...`-Parameter umstellen.',
            );
        }
    }

    private buildUrl(endpoint: string, tenantIds: string[]): string {
        const sep = endpoint.includes('?') ? '&' : '?';
        if (this.paramStyle === 'comma') {
            const enc = tenantIds.map(encodeURIComponent).join(',');
            return `${endpoint}${sep}tenantIds=${enc}`;
        }
        const params = tenantIds.map((id) => `tenantIds=${encodeURIComponent(id)}`).join('&');
        return `${endpoint}${sep}${params}`;
    }
}
