---
'create-saasicat-admin': patch
---

Fix the scaffolder doing nothing when run via `npm create` / `npx`.

The entry-point guard compared `import.meta.url` against `` `file://${process.argv[1]}` ``. Package managers expose the bin through a symlink in `node_modules/.bin/`, so under `npm create saasicat-admin` the invoked path and the module path differ, the comparison failed, and `main()` never ran — the command exited 0 without writing a single file. Published `0.2.0` is affected.

The guard now compares real paths via `realpathSync`, which resolves the bin symlink. A regression test invokes the bin through a symlink the way npx does, and fails against the old guard.
