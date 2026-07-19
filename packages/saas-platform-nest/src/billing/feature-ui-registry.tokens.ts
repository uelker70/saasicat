// DI-Token für die konsumenten-spezifische FeatureUiRegistry.
//
// Konsumenten injizieren ihre eigene Registry per `PublicCatalogModule.forRoot({ featureUiRegistry })`.
// Plattform-Code referenziert das Token statt eines Build-Time-Imports.

export const FEATURE_UI_REGISTRY_TOKEN = Symbol.for('saas-platform/FeatureUiRegistry');
