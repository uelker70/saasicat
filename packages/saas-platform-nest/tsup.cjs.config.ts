import { defineConfig } from 'tsup';
import swc from 'unplugin-swc';

import { CJS_EXTERNAL } from './tsup.shared';

// Second build pass: ONE CommonJS bundle for every public entry.
//
// The main `tsup.config.ts` emits ESM (code-split, so shared modules keep one
// identity) plus the type declarations. It also emits per-entry CJS, which
// `scripts/build-cjs-stubs.mjs` overwrites with thin re-exports of the bundle
// produced here. See `src/_all-entries.ts` for why.
//
// `clean: false` — this runs after the main build and must not wipe it.
export default defineConfig({
    entry: { _entries: 'src/_all-entries.ts' },
    format: ['cjs'],
    dts: false,
    clean: false,
    splitting: false,
    external: CJS_EXTERNAL,
    plugins: [
        swc.vite({
            jsc: {
                parser: { syntax: 'typescript', decorators: true },
                transform: {
                    legacyDecorator: true,
                    decoratorMetadata: true,
                },
                target: 'es2022',
                keepClassNames: true,
            },
        }),
    ],
});
