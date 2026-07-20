// Discovery Metadata-Konstanten
//
// SetMetadata-Keys für die Discovery-Decorators. Konvention analog zu
// `billing/feature-guard.tokens.ts` und `admin/mfa.guard.ts`: ein eigenes
// Token pro Decorator. Strings statt Symbols, weil `SetMetadata` aus
// `@nestjs/common` String-Keys nutzt und `Reflector.get()` damit arbeitet.

/** Methoden-Level: markiert eine Capability-Implementierung. */
export const IMPLEMENTS_CAPABILITY_KEY = 'discovery:implements-capability';

/** Methoden-/Klassen-Level: Runtime-Guard, Tenant muss Capability haben. */
export const REQUIRES_CAPABILITY_KEY = 'discovery:requires-capability';

/** Klassen-Level: markiert eine Klasse als QuotaProvider für einen QuotaKey. */
export const DEFINES_QUOTA_KEY = 'discovery:defines-quota';

/** Methoden-Level: Runtime-Enforcement (Increment/Check eines Quota-Counters). */
export const ENFORCE_QUOTA_KEY = 'discovery:enforce-quota';

/**
 * Provider-Token für den DiscoverySnapshot — wird vom DiscoveryModule
 * bereitgestellt und via `@Inject(DISCOVERY_SNAPSHOT_TOKEN)` konsumiert
 * (z. B. AdminController `/admin/discovery`, CatalogModule-Auto-Sync).
 *
 * `Symbol.for` (NICHT `Symbol`) ist hier zwingend: dieses Paket wird mit tsup/
 * esbuild gebaut, das CJS nicht code-splitten kann — jeder Entry-Point
 * (`./discovery`, `./catalog`, …) inlined deshalb seine EIGENE Kopie dieser
 * Datei. Ein plain `Symbol()` wäre pro Kopie ein anderes Symbol; ein Consumer,
 * der DiscoveryModule aus `./discovery` und CatalogModule aus `./catalog`
 * importiert, bekäme zwei verschiedene Tokens → DI-Match
 * schlägt fehl → Snapshot erreicht das CatalogModule nicht (Prod-Incident
 * 2026-06-09). `Symbol.for` nutzt die prozessweite Registry → identisch über
 * alle Bundle-Kopien. (#25)
 */
export const DISCOVERY_SNAPSHOT_TOKEN = Symbol.for('saas-platform/DiscoverySnapshot');
