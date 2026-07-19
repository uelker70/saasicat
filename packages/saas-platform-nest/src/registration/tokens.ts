// DI-Tokens fuer das Registration-Module.
// Konsumenten injizieren ihre Adapter-Implementations ueber diese Symbol-Tokens
// in `RegistrationModule.forRoot({...})`.

export const PENDING_REGISTRATION_REPOSITORY_TOKEN = Symbol('PENDING_REGISTRATION_REPOSITORY');
export const REGISTRATION_OTP_DELIVERY_TOKEN = Symbol('REGISTRATION_OTP_DELIVERY');
export const USER_ACCOUNT_LOOKUP_TOKEN = Symbol('USER_ACCOUNT_LOOKUP');
export const SLUG_AVAILABILITY_CHECK_TOKEN = Symbol('SLUG_AVAILABILITY_CHECK');
export const PASSWORD_HASHER_TOKEN = Symbol('PASSWORD_HASHER');
export const PLAN_CATALOG_LOOKUP_TOKEN = Symbol('PLAN_CATALOG_LOOKUP');
export const PAYMENT_PROVIDER_TOKEN = Symbol('PAYMENT_PROVIDER');
export const PAYMENT_EVENT_LOG_TOKEN = Symbol('PAYMENT_EVENT_LOG');
export const ACTIVATION_ORCHESTRATOR_TOKEN = Symbol('ACTIVATION_ORCHESTRATOR');
export const REGISTRATION_AUDIT_LOGGER_TOKEN = Symbol('REGISTRATION_AUDIT_LOGGER');
export const REGISTRATION_RESUME_TOKEN_SIGNER_TOKEN = Symbol('REGISTRATION_RESUME_TOKEN_SIGNER');
export const REGISTRATION_RESUME_DELIVERY_TOKEN = Symbol('REGISTRATION_RESUME_DELIVERY');
export const REGISTRATION_RESUME_BASE_URL_TOKEN = Symbol('REGISTRATION_RESUME_BASE_URL');
export const REGISTRATION_CONFIGURATOR_LOOKUP_TOKEN = Symbol('REGISTRATION_CONFIGURATOR_LOOKUP');
export const REGISTRATION_PROMO_PREVIEW_TOKEN = Symbol('REGISTRATION_PROMO_PREVIEW');
/** SPEC_V2 §11.1 M5.3 — published BusinessTypeVersion-Lookup für Konfigurator-Wahl. */
export const REGISTRATION_BUSINESS_TYPE_LOOKUP_TOKEN = Symbol('REGISTRATION_BUSINESS_TYPE_LOOKUP');

/** Optional injizierbare Konfiguration — fallback auf Default-TTLs aus saas-platform-types. */
export const REGISTRATION_CONFIG_TOKEN = Symbol('REGISTRATION_CONFIG');

export interface PasswordHasher {
    hash(plain: string): Promise<string>;
    verify(hash: string, plain: string): Promise<boolean>;
}
