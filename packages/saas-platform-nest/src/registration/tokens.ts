// DI tokens for the Registration module.
// Consumers inject their adapter implementations via these symbol tokens
// in `RegistrationModule.forRoot({...})`.

export const PENDING_REGISTRATION_REPOSITORY_TOKEN = Symbol.for('saas-platform/PendingRegistrationRepository');
export const REGISTRATION_OTP_DELIVERY_TOKEN = Symbol.for('saas-platform/RegistrationOtpDelivery');
export const USER_ACCOUNT_LOOKUP_TOKEN = Symbol.for('saas-platform/UserAccountLookup');
export const SLUG_AVAILABILITY_CHECK_TOKEN = Symbol.for('saas-platform/SlugAvailabilityCheck');
export const PASSWORD_HASHER_TOKEN = Symbol.for('saas-platform/PasswordHasher');
export const PLAN_CATALOG_LOOKUP_TOKEN = Symbol.for('saas-platform/PlanCatalogLookup');
export const PAYMENT_PROVIDER_TOKEN = Symbol.for('saas-platform/PaymentProvider');
export const PAYMENT_EVENT_LOG_TOKEN = Symbol.for('saas-platform/PaymentEventLog');
export const ACTIVATION_ORCHESTRATOR_TOKEN = Symbol.for('saas-platform/ActivationOrchestrator');
export const REGISTRATION_AUDIT_LOGGER_TOKEN = Symbol.for('saas-platform/RegistrationAuditLogger');
export const REGISTRATION_RESUME_TOKEN_SIGNER_TOKEN = Symbol.for('saas-platform/RegistrationResumeTokenSigner');
export const REGISTRATION_RESUME_DELIVERY_TOKEN = Symbol.for('saas-platform/RegistrationResumeDelivery');
export const REGISTRATION_RESUME_BASE_URL_TOKEN = Symbol.for('saas-platform/RegistrationResumeBaseUrl');
export const REGISTRATION_CONFIGURATOR_LOOKUP_TOKEN = Symbol.for('saas-platform/RegistrationConfiguratorLookup');
export const REGISTRATION_PROMO_PREVIEW_TOKEN = Symbol.for('saas-platform/RegistrationPromoPreview');
/** Optionally injectable configuration — falls back to default TTLs from saas-platform-types. */
export const REGISTRATION_CONFIG_TOKEN = Symbol.for('saas-platform/RegistrationConfig');

// PasswordHasher moved to @saasicat/types (core port — the SuperAdmin
// bootstrap adapter in @saasicat/adapter-prisma implements against it too).
// Re-exported here so `@saasicat/nest/registration` keeps its public surface.
export type { PasswordHasher } from '@saasicat/types';
