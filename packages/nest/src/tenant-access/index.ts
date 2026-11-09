export * from './tenant-access.module.js';
export * from './tenant-access.service.js';
export * from './tenant-access.tokens.js';
// `ReplacesPaymentMethod` stays the platform's: its one route carries it.
export {
    TENANT_ACCESS_MARK_KEY,
    Writes,
    WritesNothing,
    tenantAccessMarkOf,
} from './tenant-access-marks.js';
