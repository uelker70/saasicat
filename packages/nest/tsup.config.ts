import { defineConfig } from 'tsup';
import swc from 'unplugin-swc';

import { publicEntries } from './scripts/entries.mjs';
import { CJS_EXTERNAL } from './tsup.shared';

// tsup uses esbuild as its bundler. esbuild does NOT support
// `emitDecoratorMetadata` — so the `Reflect.metadata` calls for
// body DTOs are missing, which silently disables the global
// `ValidationPipe` in consumer apps (found 2026-05-14).
//
// Solution: run all `.ts` files through SWC first. SWC supports
// `emitDecoratorMetadata` natively and emits the
// `__metadata("design:paramtypes", [...])` calls that Nest needs
// to validate `@Body() dto: SomeDto`.

export default defineConfig({
    // Derived from `package.json` exports — adding an entry there is enough,
    // and an entry can never exist in one list but not the other.
    entry: publicEntries().map((e) => e.srcFile),
    // ESM is code-split by esbuild, so shared modules keep ONE identity across
    // entries. The CJS output emitted here is a placeholder: esbuild cannot
    // split CommonJS, so `tsup.cjs.config.ts` builds one shared bundle and
    // `scripts/build-cjs-stubs.mjs` overwrites these files with re-exports of
    // it. Types (`.d.ts`/`.d.cts`) come from this pass and stay per-entry.
    format: ['esm', 'cjs'],
    dts: true,
    // No `clean` — see scripts/build-and-prune.mjs, which the build script
    // wraps this whole three-pass build in. Emptying dist/ up front leaves a
    // window in which the JS exists and the .d.ts does not; pruning afterwards
    // removes orphans without ever exposing that state. Cleaning here would
    // also be wrong for a second reason: it would wipe the shared CJS bundle
    // and the stubs on a `tsup`-only invocation.
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
