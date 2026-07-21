// DI token for the consumer-specific FeatureUiRegistry.
//
// Consumers inject their own registry via `PublicCatalogModule.forRoot({ featureUiRegistry })`.
// Platform code references the token instead of a build-time import.

export const FEATURE_UI_REGISTRY_TOKEN = Symbol.for('saas-platform/FeatureUiRegistry');
