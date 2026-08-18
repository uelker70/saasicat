import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    // No `clean` — see scripts/build-and-prune.mjs, which the build script
    // wraps tsup in. Emptying dist/ up front leaves a window in which the JS
    // exists and the .d.ts does not; pruning afterwards removes orphans
    // without ever exposing that state.
    external: ['@saasicat/types'],
    target: 'node20',
    // The kit imports node:test/node:assert at runtime — keep the protocol.
    removeNodeProtocol: false,
});
