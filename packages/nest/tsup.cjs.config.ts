import { defineConfig } from 'tsup';

import { CJS_EXTERNAL } from './tsup.shared';

// Second build pass: ONE CommonJS bundle for every public entry.
//
// The main `tsup.config.ts` emits ESM (code-split, so shared modules keep one
// identity) plus the type declarations. It also emits per-entry CJS, which
// `scripts/build-cjs-stubs.mjs` overwrites with thin re-exports of the bundle
// produced here. See `src/_all-entries.ts` for why.
//
// `clean: false` — this runs after the main build and must not wipe it.
// Decorator metadata comes from tsup's own SWC pass, as `tsup.config.ts` says.
export default defineConfig({
    entry: { _entries: 'src/_all-entries.ts' },
    format: ['cjs'],
    dts: false,
    clean: false,
    splitting: false,
    external: CJS_EXTERNAL,
});
