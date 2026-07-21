import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    external: ['@saasicat/types'],
    target: 'node20',
    // The kit imports node:test/node:assert at runtime — keep the protocol.
    removeNodeProtocol: false,
});
