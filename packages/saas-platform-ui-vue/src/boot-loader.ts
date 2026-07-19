// BootLoader — fetcht den Public-Boot-Endpoint (öffentlich, pre-login).
//
// Liefert Branding-Minimaldaten für die SuperAdmin-Login-Seite (project.key,
// displayName, logoUrl, environment) — bewusst KEINE Capabilities oder
// Page-Definitionen vor Login.
//
// **Endpoint ist Pflicht** und wird vom App-Konsumenten geliefert, weil
// Apps unterschiedliche `globalPrefix`-Konventionen haben:
//   - vereinsfux: `globalPrefix='api/v1'` → `/api/v1/admin/boot`
//   - AutohausPro:     `globalPrefix='api'`     → `/api/admin/boot`
//
// Spec: yada-services/handoff/superadmin/SPEC.md §10.4 +
//        admin-api.openapi.yaml.

import type { PublicBootResponse } from '@saasicat/types';
import { defaultHttpClient, type HttpClient } from './types.js';

export interface BootLoaderOptions {
    /**
     * Voll-qualifizierter Boot-Endpoint inkl. App-globalPrefix
     * (`/api/admin/boot`, `/api/v1/admin/boot`, …). Pflicht.
     */
    endpoint: string;
    /** Default `defaultHttpClient()` (= `fetch`). */
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
