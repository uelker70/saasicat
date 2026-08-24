# Troubleshooting

1. **Order of `imports[]`.** `PlatformAdaptersModule` (with the repository providers)
   **must** come before the `DynamicModule.forRoot(...)` calls. Otherwise `Nest can't resolve
dependencies of the X (?, ...)` errors. NestJS 11+ is stricter here than 9/10.

2. **`@Global()` on `AdminModule`.** If the CLI wants to inject via `AdminManifestService`,
   the module must be global. Otherwise the DynamicModule factory won't find the service.

3. **`includeManifestController: false`.** If you write your own `AdminManifestController`
   (for your own guards / caching), be sure to disable the standard controller in
   `AdminManifestModule.forRoot()` — otherwise a duplicate-route error.

4. **`extraProviders` instead of global providers.** DynamicModule factories only see what is
   declared _in the same DynamicModule scope_. Dependencies of a
   `useFactory({ inject })` config must be passed via `extraProviders: [...]` in
   `forRoot()`, not as an external `providers:` list.

5. **RLS bypass for global reads.** Plan catalog, bundles, discovery are _not_
   tenant-bound. Reads must bypass RLS. The `AdminBypassRlsInterceptor` solves
   this for controller routes; in adapters that run _outside_ a request (boot,
   scheduler) you have to call `rlsBypassPort.run(() => …)` yourself.

6. **Discovery snapshot is a boot cache.** Decorator changes only become
   visible on the _next start_. In the dev container a `restart` suffices; in the UI you then
   have to click "Discovery starten" on the discovery page (or
   call `myapp doctor`, if built in).

7. **`SubscriptionContract` is immutable.** Plan change = new contract + the old one becomes
   `superseded`. Never update directly — otherwise historical invoices break.

8. **Never cache the public catalog in the frontend.** The pricing page reads
   `/public/catalog` fresh every time. Cached locally → stale prices. A classic source of
   live billing bugs.

9. **Pin the manifest hash in CI.** Check `myapp manifest hash` in a pre-deploy step
   against an expected value; unwanted manifest drifts change the UI and
   permission checks without it being obvious in the code diff.

10. **`@DefinesQuota` on the class, not the interface.** The discovery scanner
    only reads concrete classes.

11. **Clear the Vite cache after a platform build.** `file:` deps are copied by pnpm,
    but Vite bundles them into `node_modules/.vite/deps`. After
    `pnpm --filter @saasicat/ui-vue build` + `pnpm install` in the
    consumer you have to delete `.vite/deps` and restart the dev server — otherwise
    Vite serves the old version.

12. **`AdminManifestConfig` is a boot snapshot.** Plan changes via the SuperAdmin UI
    only become visible after a manifest reload (`POST /admin/manifest/reload`, MFA-required)
    — not automatically.
