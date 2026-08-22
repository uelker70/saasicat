// @saasicat/spec — CommonJS-Entrypoint
const adminManifestSchema = require('./schemas/admin-manifest.schema.json');
const planCatalogSchema = require('./schemas/plan-catalog.schema.json');
const promoCodeSchema = require('./schemas/promo-code.schema.json');
const auditEventSchema = require('./schemas/audit-event.schema.json');

module.exports = {
    adminManifestSchema,
    planCatalogSchema,
    promoCodeSchema,
    auditEventSchema,
    SCHEMAS: {
        adminManifest: adminManifestSchema,
        planCatalog: planCatalogSchema,
        promoCode: promoCodeSchema,
        auditEvent: auditEventSchema,
    },
};
