// BootLoader — fetches the public boot endpoint (public, pre-login).
//
// Provides minimal branding data for the SuperAdmin login page (project.key,
// displayName, logoUrl, environment) — deliberately NO capabilities or page
// definitions before login.
//
// **Endpoint is mandatory** and supplied by the app consumer, because apps
// have different `globalPrefix` conventions:
//   - `globalPrefix='api/v1'` → `/api/v1/admin/boot`
//   - `globalPrefix='api'`    → `/api/admin/boot`
//
// Spec: admin-api.openapi.yaml.

import type { PublicBootResponse } from '@saasicat/types';
import { defaultHttpClient, type HttpClient } from './types.js';

export interface BootLoaderOptions {
    /**
     * Fully-qualified boot endpoint incl. app globalPrefix
     * (`/api/admin/boot`, `/api/v1/admin/boot`, …). Mandatory.
     */
    endpoint: string;
    /** Defaults to `defaultHttpClient()` (= `fetch`). */
    http?: HttpClient;
}

export class BootLoadError extends Error {
    constructor(
        public readonly status: number,
        message: string,
    ) {
        super(message);
        this.name = 'BootLoadError';
    }
}

export class BootLoader {
    private readonly endpoint: string;
    private readonly http: HttpClient;

    constructor(options: BootLoaderOptions) {
        if (!options?.endpoint) {
            throw new Error(
                'BootLoader: `endpoint` ist Pflicht (z. B. "/api/admin/boot" ' +
                    'oder "/api/v1/admin/boot"). Plattform hat keinen Default, ' +
                    'weil Apps unterschiedliche globalPrefix-Konventionen haben.',
            );
        }
        this.endpoint = options.endpoint;
        this.http = options.http ?? defaultHttpClient();
    }

    async load(): Promise<PublicBootResponse> {
        const res = await this.http(this.endpoint);
        if (res.status !== 200) {
            throw new BootLoadError(res.status, `Boot-Endpunkt antwortete HTTP ${res.status}`);
        }
        return (await res.json()) as PublicBootResponse;
    }
}
