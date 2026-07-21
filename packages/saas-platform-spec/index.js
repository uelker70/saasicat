// @saasicat/spec — ESM entrypoint
// Exports all JSON schemas of the platform.
// Consumed by Nest and (prospectively) Django implementations
// as well as by CI tools (`<app> manifest check`) that validate against the schemas.
import adminManifestSchema from './schemas/admin-manifest.schema.json' with { type: 'json' };
import planCatalogSchema from './schemas/plan-catalog.schema.json' with { type: 'json' };
import promoCodeSchema from './schemas/promo-code.schema.json' with { type: 'json' };
import auditEventSchema from './schemas/audit-event.schema.json' with { type: 'json' };

export { adminManifestSchema, planCatalogSchema, promoCodeSchema, auditEventSchema };

export const SCHEMAS = {
    adminManifest: adminManifestSchema,
    planCatalog: planCatalogSchema,
    promoCode: promoCodeSchema,
    auditEvent: auditEventSchema,
};
