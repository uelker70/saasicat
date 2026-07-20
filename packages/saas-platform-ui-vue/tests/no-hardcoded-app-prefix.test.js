// Test: no composable and no loader in the platform package may hardcode an
// app-specific URL-prefix convention (`/api/...`, `/api/v1/...`) as a
// FALLBACK default.
//
// Background: apps mount their routes differently.
//   - globalPrefix='api/v1' → `/api/v1/admin/...`
//   - globalPrefix='api'    → `/api/admin/...`
// A default like `'/api/v1/admin/tenants'` in platform code always serves
// apps with `globalPrefix='api'` wrong (HTTP 404, because there
// `/api/admin/tenants` is mounted)
// and vice versa. Convention therefore: the endpoint is a required prop, no
// defaults with an `/api/...` prefix.
//
// Bug class this test catches (2026-05-10 user report):
//   - `useTenants` default `/api/v1/admin/tenants` → 404 in `api` apps
//   - `useEntitlement` default `/api/billing/entitlement` → 404 in `api/v1` apps
//   - `BootLoader`/`ManifestLoader` defaults for `api/v1` paths
//
// Allowed:
//   - Sub-path defaults without an `/api/` prefix, e.g. `'/billing'` (the app
//     supplies the base URL via the HTTP adapter).
//   - Hardcoded app paths in TESTS and TYPESCRIPT DOC COMMENTS.

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

// Patterns: flag only REAL fallback defaults or property initializations
// — NOT example URLs in error messages or JSDoc.
//
// Bug class:
//   - `options.endpoint ?? '/api/v1/admin/tenants'`     (fallback)
//   - `endpoint: '/api/v1/admin/tenants',`               (property default)
//   - `withDefaults(...{ endpoint: '/api/v1/...' })`     (Vue prop default)
//   - `new BootLoader({ endpoint: '/api/v1/...' })`      (constructor with hardcoded default)
//
// NOT flagged:
//   - `throw new Error('... "/api/admin/..." ist Pflicht ...')`
//   - JSDoc examples in comments
const FALLBACK_PATTERNS = [
    // `?? '/api/...'` — classic default-fallback pattern
    /\?\?\s*['"`](\/api\/(?:v[0-9]+\/)?(?:admin|billing)\/[^'"`]+)['"`]/g,
    // `endpoint: '/api/...'` or `default: '/api/...'` — property init
    /\b(?:endpoint|default|defaultEndpoint)\s*:\s*['"`](\/api\/(?:v[0-9]+\/)?(?:admin|billing)\/[^'"`]+)['"`]/g,
];

function findOffenders() {
    const offenders = [];
    for (const file of walk(SRC)) {
        const content = readFileSync(file, 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Skip comments and JSDoc lines — they often contain example URLs.
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

describe('Platform package: no hardcoded app URL prefixes', () => {
    test('No composable/loader has `/api/(v1/)?{admin,billing}/...` as a default', () => {
        const offenders = findOffenders();
        if (offenders.length === 0) return;
        const msg =
            `Platform code contains ${offenders.length} hardcoded app URL prefix(es):\n\n` +
            offenders
                .map((o) => `  • ${o.file}:${o.line}\n    URL: ${o.text}\n    Code: ${o.snippet}`)
                .join('\n\n') +
            `\n\nFix: make the endpoint a required prop. Apps have different\n` +
            `globalPrefix conventions (e.g. 'api' or 'api/v1'),\n` +
            `so a platform default always serves at least one app wrong.\n` +
            `Consumer wrappers pass the path-with-prefix through as a prop.`;
        assert.fail(msg);
    });
});

describe('Platform package: useTenants explicitly requires an endpoint', () => {
    test('useTenants() WITHOUT the endpoint option throws with a clear error message', async () => {
        const { useTenants } = await import('../dist/index.js');
        assert.throws(
            // @ts-expect-error — we test the runtime error when the required prop is missing.
            () => useTenants({ http: async () => ({ status: 200 }), autoLoad: false }),
            /endpoint.*Pflicht/i,
            'useTenants WITHOUT an endpoint should throw a descriptive error message',
        );
    });
});
