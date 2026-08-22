// Discovery metadata constants
//
// SetMetadata keys for the Discovery decorators. Convention analogous to
// `billing/feature-guard.tokens.ts` and `admin/mfa.guard.ts`: a separate
// token per decorator. Strings instead of symbols, because `SetMetadata` from
// `@nestjs/common` uses string keys and `Reflector.get()` works with them.

/** Method level: marks a capability implementation. */
export const IMPLEMENTS_CAPABILITY_KEY = 'discovery:implements-capability';

/** Method/class level: runtime guard, tenant must have the capability. */
export const REQUIRES_CAPABILITY_KEY = 'discovery:requires-capability';

/** Class level: marks a class as a QuotaProvider for a QuotaKey. */
export const DEFINES_QUOTA_KEY = 'discovery:defines-quota';

/** Method level: runtime enforcement (increment/check of a quota counter). */
export const ENFORCE_QUOTA_KEY = 'discovery:enforce-quota';

/**
 * Provider token for the discovery snapshot — provided by the DiscoveryModule
 * and consumed via `@Inject(DISCOVERY_SNAPSHOT_TOKEN)`
 * (e.g. AdminController `/admin/discovery`, CatalogModule auto-sync).
 *
 * `Symbol.for` (NOT `Symbol`) is mandatory here: this package is built with tsup/
 * esbuild, which cannot code-split CJS — each entry point
 * (`./discovery`, `./catalog`, …) therefore inlines its OWN copy of this
 * file. A plain `Symbol()` would be a different symbol per copy; a consumer
 * that imports DiscoveryModule from `./discovery` and CatalogModule from `./catalog`
 * would get two different tokens → the DI match
 * fails → the snapshot does not reach the CatalogModule (prod incident
 * 2026-06-09). `Symbol.for` uses the process-wide registry → identical across
 * all bundle copies. (#25)
 */
export const DISCOVERY_SNAPSHOT_TOKEN = Symbol.for('saas-platform/DiscoverySnapshot');
