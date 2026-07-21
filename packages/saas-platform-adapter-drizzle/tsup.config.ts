import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    external: ['@saasicat/types', '@nestjs/common', 'drizzle-orm'],
    target: 'node20',
    // The adapter imports node:crypto/node:async_hooks at runtime — keep the protocol.
    removeNodeProtocol: false,
});
