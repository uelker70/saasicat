// @saasicat/spec — ESM-Entrypoint
// Exportiert alle JSON-Schemas der Plattform.
// Konsumiert von Nest- und (perspektivisch) Django-Implementierungen
// sowie von CI-Tools (`<app> manifest check`), die gegen die Schemas validieren.
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
