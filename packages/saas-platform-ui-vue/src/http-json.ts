// Geteilte JSON-Helfer über den injizierbaren `HttpClient`. Ein einziger
// Request-/Fehler-Pfad für alle Pre-Login-Calls (Boot, Setup-Status, Setup),
// statt rohem `fetch` mit divergenter Fehlerbehandlung je Komponente. Ein
// Konsument-`HttpClient` (Auth-Header, baseURL, Retry) greift damit überall.

import type { HttpClient } from './types.js';

/**
 * Fehler bei Nicht-2xx-Antworten. `code` ist der maschinenlesbare Fehlercode
 * aus dem JSON-Body (`{ code }`), falls vorhanden — Aufrufer mappen ihn auf
 * eine Meldung (z. B. über `SETUP_ERROR_CODES`).
 */
export class HttpJsonError extends Error {
    constructor(
        readonly status: number,
        readonly code?: string,
    ) {
        super(code ?? `HTTP ${status}`);
        this.name = 'HttpJsonError';
    }
}

async function extractCode(res: { json(): Promise<unknown> }): Promise<string | undefined> {
    try {
        const body = (await res.json()) as { code?: unknown } | null;
        return typeof body?.code === 'string' ? body.code : undefined;
    } catch {
        return undefined;
    }
}

export async function getJson<T>(http: HttpClient, url: string): Promise<T> {
    const res = await http(url);
    if (res.status < 200 || res.status >= 300) {
        throw new HttpJsonError(res.status, await extractCode(res));
    }
    return (await res.json()) as T;
}

export async function postJson<T>(http: HttpClient, url: string, body: unknown): Promise<T> {
    const res = await http(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (res.status < 200 || res.status >= 300) {
        throw new HttpJsonError(res.status, await extractCode(res));
    }
    return (await res.json()) as T;
}
