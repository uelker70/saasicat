// @saasicat/spec — TS-Definitionen für den Schema-Export.
// Schemas werden zur Laufzeit als JSON geladen; hier nur die Typ-Hülle.

export declare const adminManifestSchema: Record<string, unknown>;
export declare const planCatalogSchema: Record<string, unknown>;
export declare const promoCodeSchema: Record<string, unknown>;
export declare const auditEventSchema: Record<string, unknown>;

export declare const SCHEMAS: {
    readonly adminManifest: Record<string, unknown>;
    readonly planCatalog: Record<string, unknown>;
    readonly promoCode: Record<string, unknown>;
    readonly auditEvent: Record<string, unknown>;
};
