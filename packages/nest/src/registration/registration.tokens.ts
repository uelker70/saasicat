// DI tokens for the Registration module.
// Consumers inject their adapter implementations via these symbol tokens
// in `RegistrationModule.forRoot({...})`.

export const PENDING_REGISTRATION_REPOSITORY_TOKEN = Symbol.for(
    'saasicat/nest/PendingRegistrationRepository',
);
export const REGISTRATION_OTP_DELIVERY_TOKEN = Symbol.for('saasicat/nest/RegistrationOtpDelivery');
export const USER_ACCOUNT_LOOKUP_TOKEN = Symbol.for('saasicat/nest/UserAccountLookup');
export const SLUG_AVAILABILITY_CHECK_TOKEN = Symbol.for('saasicat/nest/SlugAvailabilityCheck');
export const PASSWORD_HASHER_TOKEN = Symbol.for('saasicat/nest/PasswordHasher');
export const PLAN_CATALOG_LOOKUP_TOKEN = Symbol.for('saasicat/nest/PlanCatalogLookup');
export const PAYMENT_PROVIDER_TOKEN = Symbol.for('saasicat/nest/PaymentProvider');
export const PAYMENT_EVENT_LOG_TOKEN = Symbol.for('saasicat/nest/PaymentEventLog');
export const ACTIVATION_ORCHESTRATOR_TOKEN = Symbol.for('saasicat/nest/ActivationOrchestrator');
export const REGISTRATION_AUDIT_LOGGER_TOKEN = Symbol.for('saasicat/nest/RegistrationAuditLogger');
export const REGISTRATION_RESUME_TOKEN_SIGNER_TOKEN = Symbol.for(
    'saasicat/nest/RegistrationResumeTokenSigner',
);
export const REGISTRATION_RESUME_DELIVERY_TOKEN = Symbol.for(
    'saasicat/nest/RegistrationResumeDelivery',
);
export const REGISTRATION_RESUME_BASE_URL_TOKEN = Symbol.for(
    'saasicat/nest/RegistrationResumeBaseUrl',
);
export const REGISTRATION_CONFIGURATOR_LOOKUP_TOKEN = Symbol.for(
    'saasicat/nest/RegistrationConfiguratorLookup',
);
export const REGISTRATION_PROMO_PREVIEW_TOKEN = Symbol.for(
    'saasicat/nest/RegistrationPromoPreview',
);
/** Optionally injectable configuration — falls back to default TTLs from @saasicat/core. */
export const REGISTRATION_CONFIG_TOKEN = Symbol.for('saasicat/nest/RegistrationConfig');

// PasswordHasher moved to @saasicat/core (core port — the SuperAdmin
// bootstrap adapter in @saasicat/adapter-prisma implements against it too).
// Re-exported here so `@saasicat/nest/registration` keeps its public surface.
export type { PasswordHasher } from '@saasicat/core';
