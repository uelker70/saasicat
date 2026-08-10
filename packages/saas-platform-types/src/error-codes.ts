// Central error codes shared by backend AND frontend. Single source of
// truth, so that service response and UI mapping do not silently drift
// apart. String literals stay stable as the wire format.
//
// The code is the contract, not the message. Consumers resolve their own i18n
// by code; `message` is an English developer-facing fallback and may be
// reworded at any time. Renaming or removing a code is a breaking change.
//
// Scope: codes carried by thrown exceptions. Codes that travel inside
// successful responses live with their own payload type — strict-mode
// warnings in `bundle.types.ts`, plan-change and bundle-preview blockers in
// the respective preview types.

/** Codes of the first-run setup endpoints (`SetupController`). */
export const SETUP_ERROR_CODES = {
    /** `SETUP_TOKEN` env not set → setup disabled. */
    SETUP_DISABLED: 'SETUP_DISABLED',
    /** Provided token does not match. */
    INVALID_SETUP_TOKEN: 'INVALID_SETUP_TOKEN',
    /** A SUPER_ADMIN already exists — self-disable. */
    SETUP_ALREADY_DONE: 'SETUP_ALREADY_DONE',
    /** Invalid email in the request. */
    INVALID_EMAIL: 'INVALID_EMAIL',
    /** Email already taken (mapped from `PlatformUserExistsError`). */
    EMAIL_EXISTS: 'EMAIL_EXISTS',
} as const;

export type SetupErrorCode = (typeof SETUP_ERROR_CODES)[keyof typeof SETUP_ERROR_CODES];

/** Plan and bundle lifecycle in the admin catalogue. */
export const CATALOG_ERROR_CODES = {
    // ── plan master data ──
    PLAN_HAS_DRAFTS: 'PLAN_HAS_DRAFTS',
    PLAN_HAS_PUBLISHED_VERSIONS: 'PLAN_HAS_PUBLISHED_VERSIONS',
    PLAN_HARD_DELETE_NOT_IMPLEMENTED: 'PLAN_HARD_DELETE_NOT_IMPLEMENTED',

    // ── plan versions ──
    PLAN_VERSION_ALREADY_PUBLISHED: 'PLAN_VERSION_ALREADY_PUBLISHED',
    PLAN_VERSION_NOT_EDITABLE: 'PLAN_VERSION_NOT_EDITABLE',
    PLAN_VERSION_REGRESSION: 'PLAN_VERSION_REGRESSION',
    PLAN_VERSION_ZERO_PRICE: 'PLAN_VERSION_ZERO_PRICE',
    PLAN_VERSION_DISCARD_NOT_IMPLEMENTED: 'PLAN_VERSION_DISCARD_NOT_IMPLEMENTED',
    /**
     * Version cannot be terminated.
     *
     * Overloaded: raised both for "was never published" and for "already
     * superseded". A consumer cannot tell the two apart, because the
     * distinction lives only in `message`. Splitting it is a breaking change
     * and therefore staged separately.
     */
    PLAN_VERSION_NOT_LIVE: 'PLAN_VERSION_NOT_LIVE',
    PLAN_VERSION_VALID_FROM_REQUIRED: 'PLAN_VERSION_VALID_FROM_REQUIRED',
    PLAN_VERSION_VALID_FROM_INVALID: 'PLAN_VERSION_VALID_FROM_INVALID',
    PLAN_VERSION_VALID_FROM_NOT_AFTER_PREVIOUS: 'PLAN_VERSION_VALID_FROM_NOT_AFTER_PREVIOUS',
    PLAN_VERSION_VALID_FROM_NOT_GAPLESS: 'PLAN_VERSION_VALID_FROM_NOT_GAPLESS',
    PLAN_VERSION_VALID_UNTIL_INVALID: 'PLAN_VERSION_VALID_UNTIL_INVALID',
    PLAN_VERSION_VALID_UNTIL_BEFORE_FROM: 'PLAN_VERSION_VALID_UNTIL_BEFORE_FROM',
    PLAN_TERMINATE_INVALID_DATE: 'PLAN_TERMINATE_INVALID_DATE',
    PLAN_TERMINATE_DATE_NOT_FUTURE: 'PLAN_TERMINATE_DATE_NOT_FUTURE',
    PLAN_TERMINATE_NOT_IMPLEMENTED: 'PLAN_TERMINATE_NOT_IMPLEMENTED',

    // ── bundle versions ──
    BUNDLE_VERSION_ALREADY_PUBLISHED: 'BUNDLE_VERSION_ALREADY_PUBLISHED',
    BUNDLE_VERSION_NOT_EDITABLE: 'BUNDLE_VERSION_NOT_EDITABLE',
    BUNDLE_VERSION_NOT_PUBLISHED: 'BUNDLE_VERSION_NOT_PUBLISHED',
    BUNDLE_VERSION_SUPERSEDED: 'BUNDLE_VERSION_SUPERSEDED',
    BUNDLE_VERSION_REGRESSION: 'BUNDLE_VERSION_REGRESSION',
    BUNDLE_VERSION_ZERO_PRICE: 'BUNDLE_VERSION_ZERO_PRICE',
    BUNDLE_VERSION_DISCARD_NOT_IMPLEMENTED: 'BUNDLE_VERSION_DISCARD_NOT_IMPLEMENTED',
    BUNDLE_VERSION_VALID_FROM_REQUIRED: 'BUNDLE_VERSION_VALID_FROM_REQUIRED',
    BUNDLE_VERSION_VALID_FROM_INVALID: 'BUNDLE_VERSION_VALID_FROM_INVALID',
    BUNDLE_VERSION_VALID_FROM_NOT_AFTER_PREVIOUS: 'BUNDLE_VERSION_VALID_FROM_NOT_AFTER_PREVIOUS',
    BUNDLE_VERSION_VALID_FROM_NOT_GAPLESS: 'BUNDLE_VERSION_VALID_FROM_NOT_GAPLESS',
    BUNDLE_VERSION_VALID_FROM_NOT_FUTURE: 'BUNDLE_VERSION_VALID_FROM_NOT_FUTURE',
    BUNDLE_VERSION_VALID_UNTIL_INVALID: 'BUNDLE_VERSION_VALID_UNTIL_INVALID',
    BUNDLE_VERSION_VALID_UNTIL_BEFORE_FROM: 'BUNDLE_VERSION_VALID_UNTIL_BEFORE_FROM',

    /** Publish blocked by strict mode. Carries `warnings[]` with own codes. */
    STRICT_MODE_VIOLATIONS: 'STRICT_MODE_VIOLATIONS',
} as const;

export type CatalogErrorCode = (typeof CATALOG_ERROR_CODES)[keyof typeof CATALOG_ERROR_CODES];

/** Bundle bookings on a tenant subscription. */
export const BILLING_ERROR_CODES = {
    BUNDLE_ALREADY_SUBSCRIBED: 'BUNDLE_ALREADY_SUBSCRIBED',
    BUNDLE_INCOMPATIBLE_WITH_PLAN: 'BUNDLE_INCOMPATIBLE_WITH_PLAN',
    BUNDLE_NOT_SELF_SERVICE: 'BUNDLE_NOT_SELF_SERVICE',
    /**
     * Spelled with one L, unlike `SUBSCRIPTION_BUNDLE_CANCELLATION_EFFECTIVE`
     * below. Inconsistent, but the string is the wire format — correcting it
     * is a breaking change and therefore staged separately.
     */
    SUBSCRIPTION_BUNDLE_ALREADY_CANCELED: 'SUBSCRIPTION_BUNDLE_ALREADY_CANCELED',
    SUBSCRIPTION_BUNDLE_NOT_CANCELED: 'SUBSCRIPTION_BUNDLE_NOT_CANCELED',
    SUBSCRIPTION_BUNDLE_CANCELLATION_EFFECTIVE: 'SUBSCRIPTION_BUNDLE_CANCELLATION_EFFECTIVE',
} as const;

export type BillingErrorCode = (typeof BILLING_ERROR_CODES)[keyof typeof BILLING_ERROR_CODES];

/** Checkout offers and the subscription contracts derived from them. */
export const CONTRACT_ERROR_CODES = {
    CHECKOUT_OFFER_LINE_ITEMS_REQUIRED: 'CHECKOUT_OFFER_LINE_ITEMS_REQUIRED',
    CHECKOUT_OFFER_PLAN_LINE_ITEM_REQUIRED: 'CHECKOUT_OFFER_PLAN_LINE_ITEM_REQUIRED',
    CHECKOUT_OFFER_BUNDLE_LINE_ITEMS_REQUIRED: 'CHECKOUT_OFFER_BUNDLE_LINE_ITEMS_REQUIRED',
    CHECKOUT_OFFER_BUNDLE_VERSION_NOT_BOOKABLE: 'CHECKOUT_OFFER_BUNDLE_VERSION_NOT_BOOKABLE',
    CHECKOUT_OFFER_FEATURE_DEPENDENCY_UNSATISFIED: 'CHECKOUT_OFFER_FEATURE_DEPENDENCY_UNSATISFIED',

    SUBSCRIPTION_CONTRACT_LINE_ITEMS_REQUIRED: 'SUBSCRIPTION_CONTRACT_LINE_ITEMS_REQUIRED',
    SUBSCRIPTION_CONTRACT_PLAN_LINE_ITEM_REQUIRED: 'SUBSCRIPTION_CONTRACT_PLAN_LINE_ITEM_REQUIRED',
    SUBSCRIPTION_CONTRACT_INVALID_DATE: 'SUBSCRIPTION_CONTRACT_INVALID_DATE',
    SUBSCRIPTION_CONTRACT_INVALID_WINDOW: 'SUBSCRIPTION_CONTRACT_INVALID_WINDOW',
    SUBSCRIPTION_CONTRACT_TERMINATION_BEFORE_START:
        'SUBSCRIPTION_CONTRACT_TERMINATION_BEFORE_START',
} as const;

export type ContractErrorCode = (typeof CONTRACT_ERROR_CODES)[keyof typeof CONTRACT_ERROR_CODES];

/** Self-service registration funnel (`PendingRegistration`). */
export const REGISTRATION_ERROR_CODES = {
    PENDING_REGISTRATION_NOT_FOUND: 'PENDING_REGISTRATION_NOT_FOUND',
    PENDING_REGISTRATION_EXPIRED: 'PENDING_REGISTRATION_EXPIRED',
    INVALID_REGISTRATION_STATE: 'INVALID_REGISTRATION_STATE',
    OTP_INVALID: 'OTP_INVALID',
    OTP_EXPIRED: 'OTP_EXPIRED',
    OTP_LOCKED: 'OTP_LOCKED',
    /** Too many attempts from this origin. Carries `retryAfterSeconds`. */
    RATE_LIMITED: 'RATE_LIMITED',
    RESUME_TOKEN_INVALID: 'RESUME_TOKEN_INVALID',
    RESUME_NOT_CONFIGURED: 'RESUME_NOT_CONFIGURED',
    CONFIGURATOR_NOT_CONFIGURED: 'CONFIGURATOR_NOT_CONFIGURED',
    CONFIG_NOT_SAVED: 'CONFIG_NOT_SAVED',
    PLAN_NOT_AVAILABLE: 'PLAN_NOT_AVAILABLE',
    PLAN_NOT_SELECTED: 'PLAN_NOT_SELECTED',
    MODEL_NOT_AVAILABLE: 'MODEL_NOT_AVAILABLE',
} as const;

export type RegistrationErrorCode =
    (typeof REGISTRATION_ERROR_CODES)[keyof typeof REGISTRATION_ERROR_CODES];

/**
 * Every exception code the platform emits, in one object.
 *
 * Group membership is presentational — the wire format is the bare string, so
 * a code may be moved between groups without breaking consumers. Renaming or
 * removing one may not.
 */
export const PLATFORM_ERROR_CODES = {
    ...SETUP_ERROR_CODES,
    ...CATALOG_ERROR_CODES,
    ...BILLING_ERROR_CODES,
    ...CONTRACT_ERROR_CODES,
    ...REGISTRATION_ERROR_CODES,
} as const;

export type PlatformErrorCode =
    | SetupErrorCode
    | CatalogErrorCode
    | BillingErrorCode
    | ContractErrorCode
    | RegistrationErrorCode;
