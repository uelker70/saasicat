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

5. **RLS bypass for work that crosses tenants.** Every route the platform mounts behind its
   operator guard chain runs inside your `RlsBypassPort` already (`SC-SEC-015`), and so do its
   own jobs — the promo sweep, the materialisation of scheduled plan changes, the contract
   refresh. An operator controller of your own puts `AdminBypassRlsInterceptor` beside its
   guards, in a module that sees `RLS_BYPASS_PORT_TOKEN` — where it does not, the route runs as
   it is; work of your own that runs _outside_ a request (boot, a scheduler) calls
   `rlsBypass.runWithBypass(() => …)` itself. Without the frame a forced policy hides what the
   work looks for, and that reads as nothing: an empty list, a count of 0, an update of no row.

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

12. **The manifest follows the plan catalogue, within a minute.** It reads the plans on every
    request and its hash covers them, so a plan published in the SuperAdmin UI moves the ETag. A
    browser that fetched the manifest less than 60 seconds earlier (`Cache-Control: max-age=60`)
    shows the old list until it asks again. `POST /admin/manifest/reload` merges the contributions
    registered in code again; plans do not need it.
