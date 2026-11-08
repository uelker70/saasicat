// DI token of the store that keeps the reasons a tenant is held back. Reached
// from the platform's composition and from an application that binds its own
// store, so it lives in the global registry (CONTRIBUTING, "The `Symbol.for`
// rule for DI tokens").

export const TENANT_ACCESS_HOLDS_TOKEN = Symbol.for('saasicat/nest/TenantAccessHoldPort');
