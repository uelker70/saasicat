import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The admin dev server must reach THIS app's backend.
//
// `pnpm dev` in admin/ does not load the parent `.env` — that file belongs to
// docker compose. So the dev server used `vite.config.ts`'s built-in fallback
// while the compose stack published somewhere else entirely. On a machine where
// another project already occupies the default port, the admin proxies to a
// FOREIGN backend, and the login that "worked" (this example authenticates
// locally and calls no backend) is followed by a 401 carrying an error code
// from an application nobody is looking at.
//
// What this test locks in: the config reads the same file compose reads, and
// every fallback it falls back TO matches what compose itself defaults to.
//
// It deliberately reads `docker-compose.yml`, not `.env`. `.env` is gitignored —
// each developer's is different and CI has none at all. A test built on it
// passes locally and crashes in CI with ENOENT, which is how the first version
// of this file behaved.

const NOTESAPP_ROOT = new URL('..', import.meta.url);

const compose = readFileSync(fileURLToPath(new URL('docker-compose.yml', NOTESAPP_ROOT)), 'utf8');
const viteConfig = readFileSync(
    fileURLToPath(new URL('admin/vite.config.ts', NOTESAPP_ROOT)),
    'utf8',
);

/** Reads `${NAME:-1234}` out of the compose file — the repo's own default. */
function composeDefault(variable) {
    const match = new RegExp(String.raw`\$\{${variable}:-(\d+)\}`).exec(compose);
    return match ? match[1] : null;
}

/** Reads the fallback out of `X ?? '1234'` / `X ?? 1234` in the vite config. */
function configFallback(variable) {
    const match = new RegExp(String.raw`${variable}\s*\?\?\s*'?(\d+)'?`).exec(viteConfig);
    return match ? match[1] : null;
}

const PORTS = ['BACKEND_HOST_PORT', 'ADMIN_HOST_PORT'];

test('docker-compose declares a default for every port the dev server needs', () => {
    // Guards the two assertions below against a silent vacuous pass: if the
    // compose file stops declaring these, there is nothing left to compare to.
    for (const variable of PORTS) {
        assert.ok(
            composeDefault(variable),
            `docker-compose.yml declares no \${${variable}:-…} default`,
        );
    }
});

test('the vite config reads the ports from the file, not from the shell', () => {
    assert.match(
        viteConfig,
        /loadEnv\(/,
        'vite.config.ts must load examples/notesapp/.env — process.env is empty when ' +
            '`pnpm dev` runs in admin/, so relying on it means silently using the fallback',
    );
    assert.doesNotMatch(
        viteConfig,
        /process\.env\.(BACKEND|ADMIN)_HOST_PORT/,
        'reading the port straight from process.env is the bug this file exists for',
    );
});

for (const variable of PORTS) {
    test(`${variable}: the config fallback equals the compose default`, () => {
        const expected = composeDefault(variable);
        const actual = configFallback(variable);

        assert.ok(actual, `vite.config.ts declares no explicit fallback for ${variable}`);
        assert.equal(
            actual,
            expected,
            `vite.config.ts falls back to ${actual} while docker-compose.yml defaults to ` +
                `${expected}. Two numbers for one port is exactly the split that made the ` +
                `admin talk to a foreign backend — a machine-specific port belongs in .env.`,
        );
    });
}

test('.env.example documents the same defaults it tells people to override', () => {
    // The template is what a new contributor reads before they have a .env.
    // If it names other numbers than compose, the first thing they learn is wrong.
    const example = readFileSync(fileURLToPath(new URL('.env.example', NOTESAPP_ROOT)), 'utf8');
    for (const variable of PORTS) {
        const documented = new RegExp(String.raw`#?\s*${variable}\s*=\s*(\d+)`).exec(example);
        assert.ok(documented, `.env.example does not mention ${variable}`);
        assert.equal(
            documented[1],
            composeDefault(variable),
            `.env.example shows ${variable}=${documented[1]}, docker-compose defaults to ` +
                `${composeDefault(variable)}`,
        );
    }
});
