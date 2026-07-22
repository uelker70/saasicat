# create-saasicat-admin

## 0.5.0

### Minor Changes

- 6c28b77: Layer the SuperAdmin UI package: framework-free client core, Quasar-free main entry, dedicated Quasar entry.

    **Breaking (0.x minor):** `createSuperAdminApp()`, `CreateSuperAdminAppOptions` and `SuperAdminAppHandle` moved from the main entry to `@saasicat/ui-vue/quasar`:

    ```diff
    -import { createSuperAdminApp } from '@saasicat/ui-vue';
    +import { createSuperAdminApp } from '@saasicat/ui-vue/quasar';
    ```

    Everything else keeps its import path — injection keys, shell option types and `buildNavigationGuard` now live in the Vue layer and stay exported from the main entry. The scaffolder template already uses the new path.

    New:

    - `@saasicat/ui-vue/client` — the framework-free core (BootLoader, ManifestLoader with ETag cache, nav builder, action registry, batch column fetcher, HTTP contract) as its own entry with zero Vue/Pinia/Quasar imports.
    - The main entry no longer executes any `quasar` import at module load — Quasar is now a truly optional peer dependency. (`pinia`/`vue-router` are still loaded by the main entry, unchanged, for the store factory and `ProjectPageHost`.)
    - UI notify port: standard pages emit toasts via the injected `UiNotify` port (`SUPER_ADMIN_NOTIFY_KEY`) instead of calling `$q.notify` directly. `createSuperAdminApp()` provides a Quasar-backed default (same behavior as before); override it with `createSuperAdminApp({ notify })`. Without a bootstrap the pages fall back to Quasar `Notify`.
    - Layer boundaries (client ← vue ← quasar/SFCs) are enforced via ESLint `no-restricted-imports` in CI.

    Scaffolder fixes (pre-existing bugs surfaced by an end-to-end build of the scaffolded app):

    - `main.ts` template passed `manifestGuard: { errorRoute }` without the required `ensureLoaded` — the scaffolded app did not compile. The template now wires the documented pattern: `services/platform-loaders.ts` (`createPlatformLoaders`) + `stores/manifest.ts` (`createManifestStore`) feed the manifest guard.
    - `vite.config.ts` template passed `sassVariables` as a plain relative path, which current sass versions resolve against the importing file inside `node_modules/quasar` — the production build failed. Now passed as an absolute `fileURLToPath` URL.

## 0.4.0

## 0.3.0

## 0.2.1

### Patch Changes

- 41000d3: Fix the scaffolder doing nothing when run via `npm create` / `npx`.

    The entry-point guard compared `import.meta.url` against `` `file://${process.argv[1]}` ``. Package managers expose the bin through a symlink in `node_modules/.bin/`, so under `npm create saasicat-admin` the invoked path and the module path differ, the comparison failed, and `main()` never ran — the command exited 0 without writing a single file. Published `0.2.0` is affected.

    The guard now compares real paths via `realpathSync`, which resolves the bin symlink. A regression test invokes the bin through a symlink the way npx does, and fails against the old guard.

## 0.2.0

### Patch Changes

- db10ab9: Fix scaffolded projects pinning a platform version that never gets published.

    `templates/package.json.tpl` hardcoded `@saasicat/types` and `@saasicat/ui-vue` at `^0.1.0`. Because caret pins the minor for `0.x` versions, `^0.1.0` resolves to `>=0.1.0 <0.2.0` and would not match the published `0.2.0` — every scaffolded project would fail to install. The template now uses a `__PLATFORM_VERSION__` token that the scaffolder fills from its own `package.json` version, so the pin tracks each lockstep release automatically.

    Also: ship `cli-conventions.md` in `@saasicat/spec` (the `@saasicat/cli` README links to it), point package README links at absolute GitHub URLs so they resolve on npm, and translate the scaffolder's CLI output to English.
