import { defineConfig } from 'tsup';

import { publicEntries } from './scripts/entries.mjs';
import { CJS_EXTERNAL } from './tsup.shared';

// tsup bundles with esbuild, which does not emit decorator metadata: the
// `__metadata("design:paramtypes", [...])` calls Nest reads to validate an
// `@Body() dto: SomeDto` against the consumer's global `ValidationPipe`.
// Without them a body DTO goes unvalidated, and nothing says so. tsup closes
// that gap itself: where `tsconfig.json` sets `emitDecoratorMetadata`, it runs
// every source through SWC first — provided `@swc/core` is installed, without
// which it logs a warning and builds without the metadata. The tests that read
// `design:paramtypes` off the built controllers are what notice that.

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
});
