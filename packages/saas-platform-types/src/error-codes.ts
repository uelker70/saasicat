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

    // ── resources not found (stage 3) ──
    PLAN_NOT_FOUND: 'PLAN_NOT_FOUND',
    PLAN_VERSION_NOT_FOUND: 'PLAN_VERSION_NOT_FOUND',
    BUNDLE_NOT_FOUND: 'BUNDLE_NOT_FOUND',
    BUNDLE_VERSION_NOT_FOUND: 'BUNDLE_VERSION_NOT_FOUND',
    FEATURE_NOT_FOUND: 'FEATURE_NOT_FOUND',
    QUOTA_NOT_FOUND: 'QUOTA_NOT_FOUND',
    PROMOTION_NOT_FOUND: 'PROMOTION_NOT_FOUND',
    MARKETING_PROJECTION_NOT_FOUND: 'MARKETING_PROJECTION_NOT_FOUND',

    // ── already exists ──
    PLAN_ALREADY_EXISTS: 'PLAN_ALREADY_EXISTS',
    BUNDLE_ALREADY_EXISTS: 'BUNDLE_ALREADY_EXISTS',
    MARKETING_PROJECTION_ALREADY_EXISTS: 'MARKETING_PROJECTION_ALREADY_EXISTS',
    /** A draft already exists — publish or discard it before creating another. */
    PLAN_DRAFT_ALREADY_EXISTS: 'PLAN_DRAFT_ALREADY_EXISTS',
    BUNDLE_DRAFT_ALREADY_EXISTS: 'BUNDLE_DRAFT_ALREADY_EXISTS',

    // ── discovery ──
    QUOTA_NOT_IN_DISCOVERY_SNAPSHOT: 'QUOTA_NOT_IN_DISCOVERY_SNAPSHOT',
    DISCOVERY_STATUS_TRANSITION_INVALID: 'DISCOVERY_STATUS_TRANSITION_INVALID',
    DISCOVERY_NOT_INITIALIZED: 'DISCOVERY_NOT_INITIALIZED',
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

    // ── subscriptions and plan changes (stage 3) ──
    SUBSCRIPTION_NOT_FOUND: 'SUBSCRIPTION_NOT_FOUND',
    SUBSCRIPTION_TENANT_MISMATCH: 'SUBSCRIPTION_TENANT_MISMATCH',
    SUBSCRIPTION_BUNDLE_NOT_FOUND: 'SUBSCRIPTION_BUNDLE_NOT_FOUND',
    TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',
    /** No plan version is active as of the requested date. */
    NO_ACTIVE_PLAN_VERSION: 'NO_ACTIVE_PLAN_VERSION',
    /** Plan is unknown to the loaded plan catalogue. */
    PLAN_NOT_IN_CATALOG: 'PLAN_NOT_IN_CATALOG',
    /** Plan exists but cannot be booked via self-service. */
    PLAN_NOT_SELF_SERVICE: 'PLAN_NOT_SELF_SERVICE',
    /** Plan change refused. Carries `blockers[]` with their own codes. */
    PLAN_CHANGE_BLOCKED: 'PLAN_CHANGE_BLOCKED',
    NO_PENDING_PLAN_VERSION: 'NO_PENDING_PLAN_VERSION',
    ONBOARDING_CREATE_FAILED: 'ONBOARDING_CREATE_FAILED',
    BUNDLE_PREVIEW_ARGUMENT_AMBIGUOUS: 'BUNDLE_PREVIEW_ARGUMENT_AMBIGUOUS',

    // ── entitlements ──
    /** Quota exhausted. Carries `dimension`, `used`, `max`. */
    LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',
    QUOTA_DIMENSION_UNKNOWN: 'QUOTA_DIMENSION_UNKNOWN',
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

    // ── stage 3 ──
    CHECKOUT_OFFER_NOT_FOUND: 'CHECKOUT_OFFER_NOT_FOUND',
    CHECKOUT_OFFER_EXPIRED: 'CHECKOUT_OFFER_EXPIRED',
    CHECKOUT_OFFER_ALREADY_CONSUMED: 'CHECKOUT_OFFER_ALREADY_CONSUMED',
    CHECKOUT_OFFER_NOT_CONSUMED: 'CHECKOUT_OFFER_NOT_CONSUMED',
    SUBSCRIPTION_CONTRACT_NOT_FOUND: 'SUBSCRIPTION_CONTRACT_NOT_FOUND',
    NO_ACTIVE_SUBSCRIPTION_CONTRACT: 'NO_ACTIVE_SUBSCRIPTION_CONTRACT',
    SUBSCRIPTION_CONTRACT_ALREADY_CLOSED: 'SUBSCRIPTION_CONTRACT_ALREADY_CLOSED',
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

/** Authentication, role and tenant-context failures raised by the guards. */
export const AUTH_ERROR_CODES = {
    /** No authenticated user on the request. */
    NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
    /** Authenticated, but the request carries no tenant. */
    NO_TENANT_ASSIGNED: 'NO_TENANT_ASSIGNED',
    /** Neither `tenantId` nor `userId` could be resolved from the request. */
    TENANT_CONTEXT_MISSING: 'TENANT_CONTEXT_MISSING',
    TENANT_ADMIN_REQUIRED: 'TENANT_ADMIN_REQUIRED',
    SUPER_ADMIN_REQUIRED: 'SUPER_ADMIN_REQUIRED',
    /** TOTP MFA has never been set up for this user. */
    MFA_NOT_SET_UP: 'MFA_NOT_SET_UP',
    /** Endpoint is MFA-gated and no `X-Mfa-Code` header was sent. */
    MFA_REQUIRED: 'MFA_REQUIRED',
    /** The supplied TOTP code did not verify. */
    MFA_FAILED: 'MFA_FAILED',
    /** Module misconfiguration, not an end-user condition. */
    AUTH_GUARDS_NOT_CONFIGURED: 'AUTH_GUARDS_NOT_CONFIGURED',
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

/** Promo-code administration and redemption. */
export const PROMO_ERROR_CODES = {
    PROMO_CODE_NOT_FOUND: 'PROMO_CODE_NOT_FOUND',
    PROMO_CODE_ALREADY_EXISTS: 'PROMO_CODE_ALREADY_EXISTS',
    PROMO_CODE_HAS_REDEMPTIONS: 'PROMO_CODE_HAS_REDEMPTIONS',
    /** Not redeemable. Carries `reason` (`PromoPreviewInvalidReason`). */
    PROMO_CODE_NOT_REDEEMABLE: 'PROMO_CODE_NOT_REDEEMABLE',
    PROMO_CODE_FORMAT_INVALID: 'PROMO_CODE_FORMAT_INVALID',
    PROMO_PERCENT_OUT_OF_RANGE: 'PROMO_PERCENT_OUT_OF_RANGE',
    PROMO_AMOUNT_NOT_POSITIVE: 'PROMO_AMOUNT_NOT_POSITIVE',
    PROMO_ONE_OFF_WITH_DURATION: 'PROMO_ONE_OFF_WITH_DURATION',
    PROMO_DURATION_INVALID: 'PROMO_DURATION_INVALID',
    PROMO_VALIDITY_WINDOW_INVALID: 'PROMO_VALIDITY_WINDOW_INVALID',
    PROMO_PLAN_NOT_DISCOUNTABLE: 'PROMO_PLAN_NOT_DISCOUNTABLE',
    PROMO_MIN_AMOUNT_NOT_POSITIVE: 'PROMO_MIN_AMOUNT_NOT_POSITIVE',
    PROMO_WOULD_PRODUCE_ZERO_INVOICE: 'PROMO_WOULD_PRODUCE_ZERO_INVOICE',
    PROMO_MAX_REDEMPTIONS_LOWERED: 'PROMO_MAX_REDEMPTIONS_LOWERED',
} as const;

export type PromoErrorCode = (typeof PROMO_ERROR_CODES)[keyof typeof PROMO_ERROR_CODES];

/**
 * Every exception code the platform emits, in one object.
 *
 * Group membership is presentational — the wire format is the bare string, so
 * a code may be moved between groups without breaking consumers. Renaming or
 * removing one may not.
 */
export const PLATFORM_ERROR_CODES = {
    ...SETUP_ERROR_CODES,
    ...AUTH_ERROR_CODES,
    ...PROMO_ERROR_CODES,
    ...CATALOG_ERROR_CODES,
    ...BILLING_ERROR_CODES,
    ...CONTRACT_ERROR_CODES,
    ...REGISTRATION_ERROR_CODES,
} as const;

export type PlatformErrorCode =
    | SetupErrorCode
    | AuthErrorCode
    | PromoErrorCode
    | CatalogErrorCode
    | BillingErrorCode
    | ContractErrorCode
    | RegistrationErrorCode;

/**
 * Shape of a coded error response.
 *
 * Note what NestJS does with this: throwing an exception with a string
 * argument yields `{ message, error, statusCode }`, whereas throwing it with
 * an object passes that object through verbatim. Coded errors therefore carry
 * no `error`/`statusCode` field in the body — the HTTP status is on the
 * response itself, which is where a client should read it.
 */
export interface PlatformErrorBody {
    /** Stable machine-readable discriminator. Resolve i18n by this. */
    code: PlatformErrorCode;
    /** English developer-facing fallback. Do not parse it. */
    message: string;
    /**
     * Named values interpolated into `message`, so a consumer can render a
     * translated sentence without scraping the ids back out of the text.
     */
    params?: Record<string, unknown>;
}
