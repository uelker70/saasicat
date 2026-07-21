---
'@saasicat/nest': patch
---

Three wiring bugs surfaced by booting the new `examples/notesapp` reference app (the existing tests only inspected `forRoot()` results without compiling them — a Nest DI boot-smoke test now guards this):

- `SaasPlatformModule` no longer re-exports `ADMIN_MANIFEST_CONFIG` directly — exporting an imported module's token is an `UnknownExportException` at boot; the token still travels via the exported `AdminManifestModule`.
- `LimitExceededFilter` now matches by the realm-safe `isLimitExceededError` guard (new export) and falls back to Nest's default handling via `BaseExceptionFilter`. The previous `@Catch(LimitExceededError)` never matched throws from other sub-bundles (tsup duplicates the class per entry), turning quota hits from `@EnforceQuota` into HTTP 500 instead of 402. Register it as an `APP_FILTER` provider.
- `@saasicat/nest/testing` re-exports `StaticEntitlementService`, `StaticFeatureGuard`, `EnforceQuotaInterceptor` and the plan-resolver token: `moduleRef.get(X)` after `createSaasPlatformTestModule` only resolves when X comes from the same bundle entry.

Docs: quickstart corrected (`policy: 'hardCap'` — `'hard'` never existed; quota responses are HTTP 402, not 429; auth guards must be registered globally BEFORE the platform module so `request.user` is populated for the feature guard/quota interceptor).
