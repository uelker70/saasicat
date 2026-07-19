// Test: kein Composable und kein Loader im Plattform-Paket darf eine
// App-spezifische URL-Prefix-Konvention (`/api/...`, `/api/v1/...`) als
// FALLBACK-Default hardcoded haben.
//
// Hintergrund: Apps mounten ihre Routen unterschiedlich.
//   - vereinsfux: globalPrefix='api/v1' → `/api/v1/admin/...`
//   - AutohausPro:     globalPrefix='api'    → `/api/admin/...`
// Ein Default wie `'/api/v1/admin/tenants'` im Plattform-Code bedient
// AutohausPro IMMER falsch (HTTP 404, weil dort `/api/admin/tenants` mounted)
// und vice versa. Konvention deshalb: Endpoint ist Pflicht-Prop, keine
// Defaults mit `/api/...`-Präfix.
//
// Bug-Klasse, die dieser Test abfängt (2026-05-10 Bericht des Users):
//   - `useTenants` Default `/api/v1/admin/tenants` → AutohausPro-Admin 404
//   - `useEntitlement` Default `/api/billing/entitlement` → AutohausPro 404
//   - `BootLoader`/`ManifestLoader`-Defaults für vereinsfux-Pfade
//
// Erlaubt sind:
//   - Sub-Path-Defaults ohne `/api/`-Prefix, z. B. `'/billing'` (App
//     liefert die Base-URL via HTTP-Adapter).
//   - Hardcoded App-Pfade in TESTS und TYPESCRIPT-DOKU-KOMMENTAREN.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SRC = join(__dirname, '..', 'src');

function* walk(dir) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
            yield* walk(full);
        } else if (entry.endsWith('.ts') || entry.endsWith('.vue')) {
            yield full;
        }
    }
}

// Patterns: nur ECHTE Fallback-Defaults oder Property-Initialisierungen
// flaggen — NICHT Beispiel-URLs in Error-Messages oder JSDoc.
//
// Bug-Klasse:
//   - `options.endpoint ?? '/api/v1/admin/tenants'`     (Fallback)
//   - `endpoint: '/api/v1/admin/tenants',`               (Property-Default)
//   - `withDefaults(...{ endpoint: '/api/v1/...' })`     (Vue-Prop-Default)
//   - `new BootLoader({ endpoint: '/api/v1/...' })`      (Konstruktor mit hardcoded Default)
//
// NICHT geflaggt:
//   - `throw new Error('... "/api/admin/..." ist Pflicht ...')`
//   - JSDoc-Beispiele in Kommentaren
const FALLBACK_PATTERNS = [
    // `?? '/api/...'` — klassisches Default-Fallback-Pattern
    /\?\?\s*['"`](\/api\/(?:v[0-9]+\/)?(?:admin|billing)\/[^'"`]+)['"`]/g,
    // `endpoint: '/api/...'` oder `default: '/api/...'` — Property-Init
    /\b(?:endpoint|default|defaultEndpoint)\s*:\s*['"`](\/api\/(?:v[0-9]+\/)?(?:admin|billing)\/[^'"`]+)['"`]/g,
];

function findOffenders() {
    const offenders = [];
    for (const file of walk(SRC)) {
        const content = readFileSync(file, 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Skip Kommentare und JSDoc-Zeilen — die enthalten oft Beispiel-URLs.
            const trimmed = line.trim();
            if (
                trimmed.startsWith('//') ||
                trimmed.startsWith('*') ||
                trimmed.startsWith('/*') ||
                trimmed.startsWith('<!--')
            )
                continue;
            for (const pattern of FALLBACK_PATTERNS) {
                pattern.lastIndex = 0;
                const matches = line.matchAll(pattern);
                for (const m of matches) {
                    offenders.push({
                        file: relative(SRC, file),
                        line: i + 1,
                        text: m[1],
                        snippet: trimmed.slice(0, 120),
                    });
                }
            }
        }
    }
    return offenders;
}

describe('Plattform-Paket: keine hardcoded App-URL-Prefixes', () => {
    test('Kein Composable/Loader hat `/api/(v1/)?{admin,billing}/...` als Default', () => {
        const offenders = findOffenders();
        if (offenders.length === 0) return;
        const msg =
            `Plattform-Code enthält ${offenders.length} hardcoded App-URL-Prefix(es):\n\n` +
            offenders
                .map((o) => `  • ${o.file}:${o.line}\n    URL: ${o.text}\n    Code: ${o.snippet}`)
                .join('\n\n') +
            `\n\nFix: Endpoint zu Pflicht-Prop machen. Apps haben unterschiedliche\n` +
            `globalPrefix-Konventionen (AutohausPro: 'api', vereinsfux: 'api/v1'),\n` +
            `ein Plattform-Default bedient deshalb immer mindestens eine App falsch.\n` +
            `Konsumenten-Wrapper passen Pfad-mit-Prefix als Prop durch.`;
        assert.fail(msg);
    });
});

describe('Plattform-Paket: useTenants verlangt explizit Endpoint', () => {
    test('useTenants() OHNE endpoint-Option wirft mit klarer Fehlermeldung', async () => {
        const { useTenants } = await import('../dist/index.js');
        assert.throws(
            // @ts-expect-error — wir testen Runtime-Fehler bei fehlendem Pflicht-Prop.
            () => useTenants({ http: async () => ({ status: 200 }), autoLoad: false }),
            /endpoint.*Pflicht/i,
            'useTenants OHNE endpoint sollte eine sprechende Fehlermeldung werfen',
        );
    });
});
