# create-saasicat-admin

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
