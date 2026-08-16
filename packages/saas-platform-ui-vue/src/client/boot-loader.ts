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
import { markPlatformError } from './admin-error.js';
import { requireServerAnswer } from './http-json.js';
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
        // Identity, so `toAdminError` can tell this diagnostic from a
        // consumer error whose message an operator needs to read.
        markPlatformError(this);
    }
}

export class BootLoader {
    private readonly endpoint: string;
    private readonly http: HttpClient;

    constructor(options: BootLoaderOptions) {
        if (!options?.endpoint) {
            throw new Error(
                'BootLoader: `endpoint` is required (e.g. "/api/admin/boot" ' +
                    'or "/api/v1/admin/boot"). The platform has no default ' +
                    'because apps use different globalPrefix conventions.',
            );
        }
        this.endpoint = options.endpoint;
        this.http = options.http ?? defaultHttpClient();
    }

    async load(): Promise<PublicBootResponse> {
        const res = await this.http(this.endpoint);
        requireServerAnswer(
            res.status,
            'GET',
            this.endpoint,
            (diagnostic) => new BootLoadError(res.status, diagnostic),
        );
        if (res.status !== 200) {
            throw new BootLoadError(res.status, `Boot endpoint responded with HTTP ${res.status}`);
        }
        return (await res.json()) as PublicBootResponse;
    }
}
