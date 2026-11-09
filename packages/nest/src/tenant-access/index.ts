export * from './tenant-access.module.js';
export * from './tenant-access.service.js';
export * from './tenant-access.tokens.js';
// `StartsPayment` stays the platform's: only its own payment routes carry it.
export {
    TENANT_ACCESS_MARK_KEY,
    Writes,
    WritesNothing,
    tenantAccessMarkOf,
} from './tenant-access-marks.js';
