---
'@saasicat/adapter-prisma': minor
'@saasicat/nest': minor
---

Make the CommonJS entry points share one set of objects, and open the seams a
consumer app needs when its shape does not match the standard stack's defaults.
Each of these was previously unreachable, so an app that hit one had to abandon
`SaaSiCatModule` entirely rather than configure around it.

- **The CJS build now emits one shared bundle** (`dist/_entries.cjs`) with a
  thin re-export per entry, instead of a separate bundle per entry. esbuild
  cannot code-split CommonJS, so every shared module used to be copied into each
  entry — and since Nest resolves providers by class reference, two copies of a
  class are two different providers. Composing `SaaSiCatModule` (from
  `./platform`) with `SetupModule` (from the root entry) failed at boot with
  "MfaService is not available in the SetupModule module". ESM was already
  code-split and unaffected. Consumers no longer need to know which entry a
  class "really" comes from.
- Exported DI tokens that were still plain `Symbol()` are now `Symbol.for`,
  per the rule in `CONTRIBUTING.md` — 42 of them, including
  `ADMIN_MANIFEST_CONFIG`. The catalog and billing `FEATURE_UI_REGISTRY_TOKEN`
  stay deliberately distinct and are now namespaced apart rather than colliding
  by accident.
- `@saasicat/nest/platform` additionally re-exports the modules and services an
  app composes alongside `SaaSiCatModule` (`AdminModule`, `AdminManifestModule`,
  `AdminStatsModule`, `SetupModule`, `CheckoutOfferModule`,
  `SubscriptionContractModule` and their services), so the standard stack can be
  assembled from a single import path.
- New `globalFeatureGuard` option. The module bound `StaticFeatureGuard` as a
  global `APP_GUARD` unconditionally. Nest runs every global guard before every
  controller-local one, so apps that authenticate in a controller-local guard
  got a 403 on all feature-gated routes before authentication had run. Set
  `false` to bind the guard behind your own auth guard instead. The quota
  interceptor stays global either way — interceptors run after all guards.
- `includeManifestController` is now passed through to `AdminManifestModule`.
  Apps serving `GET /admin/manifest` from their own controller could not
  suppress the platform one, and two controllers on one path abort the boot with
  a duplicate-route error.
- `prismaPersistence()` accepts a `bundle` option forwarded to both bundle
  repositories it builds. Because the bundle constructs them directly rather
  than through Nest DI, the repository's `@Optional()` options provider never
  applied, leaving `validityWindows` unreachable — bundle publishes then
  silently dropped `validFrom`.
