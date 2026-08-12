import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The admin dev server must proxy `/api` to THIS app's backend.
//
// It once did not. `vite.config.ts` fell back to port 3000 when
// `BACKEND_HOST_PORT` was absent from the shell — while its own comment said
// the default was 4000 and `.env` said `BACKEND_HOST_PORT=4000`. On a machine
// that also runs the other consumer stacks, port 3000 is a *different
// product's* API.
//
// The result was a login that appeared to work (this example authenticates
// locally, no backend call) followed by `401 {"code":"NO_BEARER_TOKEN"}` from a
// guard belonging to an application nobody was looking at. Hours of debugging
// the wrong codebase — from one stale fallback.
//
// The rule this locks in: every port the dev server uses comes from `.env`,
// and no fallback in the config may contradict it.

const NOTESAPP_ROOT = new URL('..', import.meta.url);

function readEnvPorts() {
    const raw = readFileSync(fileURLToPath(new URL('.env', NOTESAPP_ROOT)), 'utf8');
    const ports = {};
    for (const line of raw.split('\n')) {
        const match = /^\s*([A-Z_]+)\s*=\s*([^\s#]+)/.exec(line);
        if (match) ports[match[1]] = match[2];
    }
    return ports;
}

const viteConfig = readFileSync(
    fileURLToPath(new URL('admin/vite.config.ts', NOTESAPP_ROOT)),
    'utf8',
);

test('.env declares the ports the dev server needs', () => {
    const env = readEnvPorts();
    assert.ok(env.BACKEND_HOST_PORT, '.env must declare BACKEND_HOST_PORT');
    assert.ok(env.ADMIN_HOST_PORT, '.env must declare ADMIN_HOST_PORT');
});

test('the vite config reads the ports from .env, not from the shell', () => {
    // `process.env` is empty when `pnpm dev` runs in admin/ — the parent `.env`
    // is a docker-compose file, and nothing loads it into the shell.
    assert.match(
        viteConfig,
        /loadEnv\(/,
        'vite.config.ts must load examples/notesapp/.env instead of trusting process.env',
    );
    assert.doesNotMatch(
        viteConfig,
        /process\.env\.(BACKEND|ADMIN)_HOST_PORT/,
        'reading the port straight from process.env silently falls back when it is unset',
    );
});

test('no fallback port in the config contradicts .env', () => {
    const env = readEnvPorts();

    const backendFallback = /BACKEND_HOST_PORT\s*\?\?\s*'(\d+)'/.exec(viteConfig);
    assert.ok(backendFallback, 'expected an explicit backend port fallback');
    assert.equal(
        backendFallback[1],
        env.BACKEND_HOST_PORT,
        `the backend fallback (${backendFallback?.[1]}) must equal BACKEND_HOST_PORT ` +
            `in .env (${env.BACKEND_HOST_PORT}) — a divergent one points the admin at ` +
            `whatever else happens to listen on that port`,
    );

    const adminFallback = /ADMIN_HOST_PORT\s*\?\?\s*(\d+)/.exec(viteConfig);
    assert.ok(adminFallback, 'expected an explicit admin port fallback');
    assert.equal(adminFallback[1], env.ADMIN_HOST_PORT, 'admin fallback must equal .env');
});

test('the backend port is not the default a sibling stack would occupy', () => {
    const env = readEnvPorts();
    // 3000 is the container-internal port every NestJS app in this workspace
    // uses, so it is the one most likely to be published by another stack.
    assert.notEqual(
        env.BACKEND_HOST_PORT,
        '3000',
        'publishing the API on 3000 collides with the other consumer stacks on a dev machine',
    );
});
