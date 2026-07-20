// @saasicat/nest/discovery — Code-Discovery via Decorators.
//
// Vier Decorators (siehe `decorators.ts`):
//   - @ImplementsCapability(key, options)
//   - @RequiresCapability(...keys)
//   - @DefinesQuota(options)
//   - @EnforceQuota(key, options)
//
// Plus der Boot-Zeit-Scanner (`DiscoveryScanner`), das DI-Modul
// (`DiscoveryModule`) und die Tokens für Consumer.

export * from './decorators.js';
export {
    DISCOVERY_APP_INFO_TOKEN,
    DISCOVERY_SNAPSHOT_PATH_TOKEN,
    DiscoveryScanner,
    computeSnapshotHash,
} from './discovery.scanner.js';
export type { DiscoveryAppInfo } from './discovery.scanner.js';
export { DiscoveryModule } from './discovery.module.js';
export {
    DiscoverySnapshotNotFoundError,
    loadDiscoverySnapshotFromFile,
} from './snapshot-loader.js';
export { runHeadlessDiscoveryScan, type HeadlessScanOptions } from './headless-scan.js';
export type { DiscoveryControllerConfig, DiscoveryModuleOptions } from './discovery.module.js';
export { buildDiscoveryController } from './discovery.controller.js';
export {
    DISCOVERY_SNAPSHOT_TOKEN,
    IMPLEMENTS_CAPABILITY_KEY,
    REQUIRES_CAPABILITY_KEY,
    DEFINES_QUOTA_KEY,
    ENFORCE_QUOTA_KEY,
} from './tokens.js';
export type {
    DiscoveredCapability,
    DiscoveredFeature,
    DiscoveredQuota,
    DiscoverySnapshot,
    DefinesQuotaOptions,
    EnforceQuotaOptions,
    ImplementsCapabilityOptions,
    RequiresCapabilityKeys,
} from './types.js';
