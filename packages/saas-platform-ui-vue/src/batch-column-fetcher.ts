// BatchColumnFetcher — lädt Custom-TenantColumn-Daten in EINEM Request pro
// Spalte (Pflicht aus SPEC §4.6: kein N+1 für die Tenant-Page-Tabelle).
//
// Manifest-Vertrag: jede `TenantColumnDef.endpoint` MUSS batchfähig sein —
// kein `{slug}` oder `{tenantId}`-Placeholder im Pfad. Der Fetcher hängt
// `?tenantIds=t1,t2,...,tN` (oder `tenantIds=t1&tenantIds=t2&...` — die
// `paramStyle`-Option wählt das Format) an und erwartet eine Antwort der
// Form `Record<tenantId, value>`.
//
// Capability-Filter: Spalten ohne erfüllte `requiredCapability` werden
// gar nicht erst gefetcht. Manifest-Drift (Spalten-`endpoint` mit
// `{slug}`-Pattern) wird strukturiert mit `BatchColumnDriftError`
// gemeldet — Konsumenten-Shell rendert dann eine Warnung.

import type { AdminManifest, TenantColumnDef } from '@saasicat/types';
import { defaultHttpClient, type HttpClient } from './types.js';

export type BatchColumnValue = unknown;

/** Pro `tenantId` ein Wert (frei strukturiert). */
export type BatchColumnRow = Record<string, BatchColumnValue>;

/** Pro Spalten-Key ein `tenantId → value`-Map. */
export type BatchColumnData = Record<string, BatchColumnRow>;

export type ParamStyle = 'comma' | 'repeat';

export interface BatchColumnFetcherOptions {
    http?: HttpClient;
    /**
     * Wie die `tenantIds` an den Endpoint übergeben werden. Default
     * `'comma'` → `?tenantIds=t1,t2,t3`. `'repeat'` → `?tenantIds=t1&tenantIds=t2`.
     * Konsumenten-Backends entscheiden je nach Framework (NestJS akzeptiert
     * standardmäßig comma-getrennte Strings oder mit `@Query() ids: string[]`).
     */
    paramStyle?: ParamStyle;
    /**
     * Auth-Token-Provider für `Authorization: Bearer <token>`. Konsument
     * liefert eine Funktion, die den aktuellen Token aus dem Auth-Store
     * zieht.
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
     * Lädt die Daten für alle im Manifest deklarierten Spalten parallel
     * (eine Request pro Spalte, alle `tenantIds` im Batch). Spalten ohne
     * erfüllte Capability werden ignoriert.
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

    /** Einzelne Spalte abrufen (Konsumenten dürfen das auch direkt nutzen). */
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
     * Spalten-Drift gegen das Manifest. Konsumenten nutzen das für CI-
     * Smoke-Tests des Manifest-vs-Shell-Builds.
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
     * Welche Spalten haben eine erfüllte `requiredCapability`? Manifest =
     * Discovery, also reicht der Local-Check.
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
