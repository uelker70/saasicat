// Registration / PendingRegistration — Multi-step registration and
// onboarding flow.
//
// A PendingRegistration holds the intermediate state between step 1
// (capturing sign-up data) and the final activation (step 4: payment).
// Only after successful payment does it become User + Tenant + Subscription.
// Until then the record stays decoupled from the production user model.

export const PENDING_EMAIL_TTL_HOURS = 72;
export const PENDING_ONBOARDING_TTL_DAYS = 14;
export const PENDING_CHECKOUT_TTL_DAYS = 30;
export const OTP_TTL_MINUTES = 10;
export const PASSWORD_RESET_TTL_MINUTES = 30;

/** Number of OTP sends per rolling window before further sends are silently swallowed. */
export const OTP_RATE_LIMIT_MAX_SENDS = 3;
export const OTP_RATE_LIMIT_WINDOW_MINUTES = 15;

/**
 * Max. verification attempts per OTP code (each attempt atomically claims a
 * slot before the hash comparison). Once reached, `verifyOtp()` throws
 * `OTP_LOCKED` — even for a subsequently correct code. A newly generated OTP
 * resets the counter (sending stays rate-limited separately).
 * Env override: `SAAS_PLATFORM_OTP_VERIFY_MAX_ATTEMPTS`.
 */
export const OTP_VERIFY_MAX_ATTEMPTS = 5;

export type RegistrationStatus =
    | 'PENDING_EMAIL_VERIFICATION'
    | 'EMAIL_VERIFIED'
    | 'PLAN_SELECTED'
    | 'CHECKOUT_STARTED'
    | 'EXPIRED'
    | 'DELETED';

export type RegistrationStep = 1 | 2 | 3 | 4;

/** Mapping status -> step that the frontend uses after login/resume. */
export const REGISTRATION_STEP_BY_STATUS: Record<RegistrationStatus, RegistrationStep> = {
    PENDING_EMAIL_VERIFICATION: 2,
    EMAIL_VERIFIED: 3,
    PLAN_SELECTED: 4,
    CHECKOUT_STARTED: 4,
    EXPIRED: 1,
    DELETED: 1,
};

export interface PendingRegistration {
    id: string;

    tenantName: string;
    tenantSlug: string | null;
    salutation: string | null;
    firstName: string;
    lastName: string;
    email: string;
    passwordHash: string;
    locale: string;

    status: RegistrationStatus;
    currentStep: RegistrationStep;

    emailVerifiedAt: Date | null;

    otpHash: string | null;
    otpExpiresAt: Date | null;
    otpSendCount: number;
    lastOtpSentAt: Date | null;
    /** Persistent counter of OTP verification attempts (brute-force lockout). */
    otpAttemptCount: number;

    selectedPlanId: string | null;

    /** Configurator selection snapshot (step 3). Set by the service. */
    configJson: RegistrationConfigSelection | null;
    /** Set on the first `saveConfiguration()` call. */
    billingCycle: 'MONTHLY' | 'YEARLY' | null;
    /** Plaintext code (UI display). Validation runs fresh every time. */
    appliedPromoCode: string | null;

    checkoutSessionId: string | null;
    checkoutStartedAt: Date | null;

    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

export interface PendingRegistrationCreateInput {
    tenantName: string;
    tenantSlug: string | null;
    salutation: string | null;
    firstName: string;
    lastName: string;
    email: string;
    passwordHash: string;
    locale: string;
    otpHash: string;
    otpExpiresAt: Date;
    expiresAt: Date;
}

export interface PendingRegistrationUpdateInput {
    status?: RegistrationStatus;
    currentStep?: RegistrationStep;
    emailVerifiedAt?: Date | null;
    otpHash?: string | null;
    otpExpiresAt?: Date | null;
    otpSendCount?: number;
    lastOtpSentAt?: Date | null;
    otpAttemptCount?: number;
    selectedPlanId?: string | null;
    configJson?: RegistrationConfigSelection | null;
    billingCycle?: 'MONTHLY' | 'YEARLY' | null;
    appliedPromoCode?: string | null;
    checkoutSessionId?: string | null;
    checkoutStartedAt?: Date | null;
    expiresAt?: Date;
}

/** Adapter port: persistence for PendingRegistration (CRUD). */
export interface PendingRegistrationRepository {
    findById(id: string): Promise<PendingRegistration | null>;
    findByEmail(email: string): Promise<PendingRegistration | null>;
    /** Webhook lookup: finds the pending record for the provider session. */
    findByCheckoutSession(sessionId: string): Promise<PendingRegistration | null>;
    /**
     * Cleanup lookup: all pending records with `expiresAt < now`, max
     * `limit` entries per call (batch protection). Ordering irrelevant, the
     * cron service iterates sequentially.
     */
    findExpired(now: Date, limit: number): Promise<PendingRegistration[]>;
    create(input: PendingRegistrationCreateInput): Promise<PendingRegistration>;
    update(id: string, input: PendingRegistrationUpdateInput): Promise<PendingRegistration>;
    /**
     * Increments `otpAttemptCount` atomically by 1 and returns the NEW value.
     * Must be atomic on the DB side (e.g. Prisma `{ increment: 1 }`) so that
     * parallel failed attempts do not overwrite each other — the return
     * value is the authoritative threshold for the lockout check.
     */
    incrementOtpAttemptCount(id: string): Promise<number>;
    delete(id: string): Promise<void>;
}

/** Adapter port: detects whether a full user account (verified) exists for this email. */
export interface UserAccountLookup {
    hasActiveUser(email: string): Promise<boolean>;
}

/** Adapter port: check whether a slug is available for a new tenant. */
export interface SlugAvailabilityCheck {
    isSlugAvailable(slug: string): Promise<boolean>;
}

/** Wire format of a created checkout session (provider-agnostic). */
export interface CheckoutSession {
    /** Provider-specific session ID (e.g. Stripe `cs_…`). */
    sessionId: string;
    /** Payment URL to be opened by the frontend. */
    checkoutUrl: string;
    /** Optional: provider name (`stripe`, `dev-stub`) for logging/audit. */
    provider?: string;
}

export type PaymentEventStatus = 'SUCCEEDED' | 'FAILED';

/**
 * Adapter port: idempotency log for payment webhooks. Stripe (and most
 * other providers) deliver events at-least-once — the service calls
 * `tryClaim` as an atomic race guard BEFORE it triggers the final
 * activation.
 */
export interface PaymentEventLog {
    /**
     * Tries to insert an event record via `@unique` INSERT. Returns
     * `true` if it was newly created (webhook seen for the first time),
     * `false` if it already exists (duplicate → silently drop).
     *
     * Implementations must return a DB unique-constraint-violation error
     * (Prisma P2002) as `false`.
     */
    tryClaim(
        eventId: string,
        payload: {
            provider: string;
            sessionId: string | null;
            status: PaymentEventStatus;
            rawPayload?: unknown;
        },
    ): Promise<boolean>;
}

export interface FinalActivationResult {
    userId: string;
    tenantId: string;
    subscriptionId: string;
}

/**
 * Adapter port: orchestrates the final creation of User + Tenant +
 * Subscription after successful payment. App-specific — each app has its
 * own schema (e.g. Tenant + TenantUser + Role + UserRole +
 * Subscription).
 *
 * Implementations MUST perform the creation in a DB transaction so that
 * partial creations are fully rolled back on errors.
 */
export interface ActivationOrchestrator {
    activate(pending: PendingRegistration): Promise<FinalActivationResult>;
}

export interface HandlePaymentEventInput {
    eventId: string;
    sessionId: string | null;
    provider: string;
    status: PaymentEventStatus;
    rawPayload?: unknown;
}

export type HandlePaymentEventReason =
    | 'ALREADY_PROCESSED'
    | 'PAYMENT_NOT_SUCCEEDED'
    | 'MISSING_SESSION_ID'
    | 'PENDING_REGISTRATION_NOT_FOUND'
    | 'INVALID_STATE';

export interface HandlePaymentEventResult {
    activated: boolean;
    reason?: HandlePaymentEventReason;
    result?: FinalActivationResult;
}

export interface CleanupResult {
    /** Number of deleted PendingRegistration records. */
    deleted: number;
    /**
     * `true` if the batch limit was reached — the next cron run
     * handles the rest. Prevents memory spikes on large backlogs.
     */
    moreAvailable: boolean;
}

export type RegistrationAuditEventType =
    | 'REGISTRATION_STARTED'
    | 'REGISTRATION_NEUTRAL_ACTIVE_USER'
    | 'REGISTRATION_NEUTRAL_REPLAY'
    | 'REGISTRATION_NEUTRAL_EXPIRED'
    | 'OTP_VERIFIED'
    | 'OTP_VERIFY_FAILED'
    | 'OTP_RESEND_REQUESTED'
    | 'OTP_RATE_LIMIT_HIT'
    | 'PLAN_SELECTED'
    | 'CHECKOUT_STARTED'
    | 'PAYMENT_RECEIVED'
    | 'PAYMENT_DUPLICATE_IGNORED'
    | 'PAYMENT_FAILED'
    | 'ACTIVATION_COMPLETED'
    | 'LOGIN_SUCCEEDED'
    | 'LOGIN_INVALID_CREDENTIALS'
    | 'LOGIN_ONBOARDING_REQUIRED';

/**
 * Context information that the audit layer records per event.
 * IP is expected as a hashed fingerprint — no plaintext IPs in the
 * audit log (GDPR/compliance), no plaintext email (account enumeration).
 */
export interface RegistrationAuditContext {
    ipHash?: string | null;
    userAgent?: string | null;
}

export interface RegistrationAuditEvent {
    eventType: RegistrationAuditEventType;
    /**
     * Pending registration ID, if already known. `null` for neutral
     * responses (e.g. `start` without a new pending record).
     */
    pendingRegistrationId: string | null;
    context?: RegistrationAuditContext;
    /**
     * Free-form metadata field. NEVER put email/password/OTP in plaintext —
     * implementations must enforce that themselves.
     */
    metadata?: Record<string, unknown>;
}

/**
 * Adapter port: persists audit events for the registration flow.
 * Implementations typically target the app's respective `AuditLog` table.
 *
 * Log failures must not abort the auth flow — implementations should
 * catch errors internally and only log them, not throw.
 */
export interface RegistrationAuditLogger {
    log(event: RegistrationAuditEvent): Promise<void>;
}

/* ─── Configurator data model (onboarding step 3) ───────────────────────── */

export interface ConfiguratorModel {
    id: string;
    code: string;
    name: string;
    glyph: string;
    tagline: string;
    /** Mapping to the PlanCatalog (STARTER/STANDARD/PROFESSIONAL). */
    planId: string;
    monthlyNet: number;
    yearlyNet: number;
    tags: string[];
    /** Feature keys included in the model price (PlanVersion.features). */
    includedFeatureKeys: string[];
    quotaBase: Record<string, number>;
    popular?: boolean;
}

export interface ConfiguratorCatalog {
    /** Factor `yearlyNet = monthlyNet * cycleDiscount` (typically 10 = 2 months free). */
    cycleDiscount: number;
    currency: string;
    vatRate: number;
    models: ConfiguratorModel[];
}

export interface RegistrationConfigSelection {
    modelId: string;
    billingCycle: 'MONTHLY' | 'YEARLY';
    appliedPromoCode: string | null;
    /**
     * P11.4 (METAMODELL §17a): preselected CheckoutOffer from the website
     * (`?offer=<id>` parameter). Moves into `PendingRegistration.configJson`,
     * is read by the `ActivationOrchestrator` to consume the offer during
     * onboarding activation (`status=consumed`) and freeze it into
     * `Subscription.packageSnapshot`. When `null`, activation runs
     * without an offer snapshot.
     */
    offerId?: string | null;
}

export interface ConfiguratorPriceBreakdown {
    cycle: 'MONTHLY' | 'YEARLY';
    effectiveQuotas: Record<string, number>;
    modelMonthlyNet: number;
    subtotalMonthlyNet: number;
    subtotalNet: number;
    discountAmount: number;
    totalNet: number;
    vatRate: number;
    totalGross: number;
    yearlySavings: number;
    appliedPromo?: {
        code: string;
        label: string;
        percent: number;
    };
}

export interface SaveRegistrationConfigInput {
    pendingRegistrationId: string;
    selection: RegistrationConfigSelection;
}

export interface SaveRegistrationConfigResult {
    pendingRegistrationId: string;
    status: RegistrationStatus;
    nextStep: RegistrationStep;
    selection: RegistrationConfigSelection;
    breakdown: ConfiguratorPriceBreakdown;
}

/**
 * Adapter port: provides the (app-specific) configurator catalog.
 *
 * Recommended implementation: `ConfiguratorCatalogBuilder` from
 * `saas-platform-nest/billing`. The builder combines SuperAdmin DB data
 * (live PlanVersions) with an app-local plan marketing map.
 */
export interface RegistrationConfiguratorLookup {
    getCatalog(): Promise<ConfiguratorCatalog>;
}

/**
 * Wire format of a live PlanVersion (latest published per planId).
 * Read from the DB table `plan_versions`.
 */
export interface ConfiguratorPlanVersionRow {
    planId: string;
    version: number;
    monthlyNet: number;
    yearlyNet: number;
    /** Feature keys included in the plan price. */
    features: string[];
    /** Quota key → base value (`-1` = unlimited). */
    quotas: Record<string, number>;
    marketed: boolean;
}

/**
 * Adapter port: reads the configurator sources from the DB (SuperAdmin
 * maintains them). Consumers typically use a Prisma implementation.
 */
export interface ConfiguratorSourcesLookup {
    listLivePlans(): Promise<ConfiguratorPlanVersionRow[]>;
}

/**
 * App-local marketing data for the plan selection area of the configurator.
 * The SuperAdmin stores only PlanId/prices — the "model" presentation
 * (club name, glyph, tagline) is branding and lives in the app.
 */
export interface ConfiguratorPlanMarketing {
    /** PlanId from the SuperAdmin (e.g. `STARTER`). */
    planId: string;
    code: string;
    name: string;
    glyph: string;
    tagline: string;
    tags: string[];
    popular?: boolean;
}

/**
 * Adapter port: provides the app-specific marketing data (plan names,
 * price parameters). Typically supplied by a static TS constant
 * in the app.
 */
export interface ConfiguratorMarketingProvider {
    listPlanMarketing(): ConfiguratorPlanMarketing[];
    /** Factor `yearlyNet = monthlyNet * cycleDiscount`. Default `10`. */
    getCycleDiscount(): number;
    getVatRate(): number;
    getCurrency(): string;
}

/**
 * Adapter port: promo-code preview against a gross subtotal.
 * Typically wraps `saas-platform-nest/promo:PromoCodesService.preview()`.
 */
export interface RegistrationPromoPreview {
    preview(params: {
        code: string;
        planId: string;
        billingCycle: 'MONTHLY' | 'YEARLY';
        subtotalGross: number;
        /** Optional for the firstTimeCustomersOnly check. */
        email?: string;
    }): Promise<{
        valid: boolean;
        reason?: string;
        percent?: number;
        label?: string;
        discountAmount?: number;
    }>;
}

/** Default TTL for signed resume tokens (60 min). */
export const REGISTRATION_RESUME_TTL_MINUTES = 60;

/**
 * Adapter port: signs / verifies resume tokens for the
 * "resume registration" flow (cases C/D per spec).
 *
 * Token payload is a provider detail (typically JWT) — the service only knows
 * `pendingRegistrationId` as content and `ttlMinutes` as the expiry window.
 */
export interface RegistrationResumeTokenSigner {
    sign(params: { pendingRegistrationId: string; ttlMinutes?: number }): Promise<string>;
    /**
     * Verifies the token. Throws if signature or expiry do not match
     * — the service layer translates this into a BadRequestException with
     * code `RESUME_TOKEN_INVALID`.
     */
    verify(token: string): Promise<{ pendingRegistrationId: string }>;
}

/** Adapter port: sends the resume-link email to the user. */
export interface RegistrationResumeDelivery {
    sendResumeEmail(params: {
        to: string;
        firstName: string;
        locale: string;
        resumeUrl: string;
    }): Promise<void>;
}

/**
 * Input to `PendingRegistrationService.resumeWithToken()` — the frontend
 * passes the token from the `?resume=<jwt>` query.
 */
export interface ResumeRegistrationInput {
    token: string;
    /**
     * Base URL of the app against which the resume link is generated
     * (e.g. `https://app.example.com`). Only forwarded to the mail delivery,
     * the service itself hosts no link.
     */
    resumeBaseUrl?: string;
}

/**
 * Public-safe snapshot of a PendingRegistration for the resume flow:
 * the frontend fills the completed onboarding steps with this data.
 *
 * Deliberately WITHOUT `passwordHash`, `otpHash`, `otpExpiresAt` — these must
 * never go to the client.
 */
export interface PendingRegistrationSnapshot {
    tenantName: string;
    tenantSlug: string | null;
    salutation: string | null;
    firstName: string;
    lastName: string;
    email: string;
    locale: string;
    status: RegistrationStatus;
    currentStep: RegistrationStep;
    emailVerifiedAt: string | null;
    selectedPlanId: string | null;
    /** Configurator selection snapshot for step-3 resume. */
    config: RegistrationConfigSelection | null;
    billingCycle: 'MONTHLY' | 'YEARLY' | null;
    appliedPromoCode: string | null;
    checkoutSessionId: string | null;
}

export interface ResumeRegistrationResult {
    pendingRegistrationId: string;
    status: RegistrationStatus;
    nextStep: RegistrationStep;
    snapshot: PendingRegistrationSnapshot;
}

/** Adapter port: payment provider (Stripe, Dev-Stub, Mollie, ...). */
export interface PaymentProvider {
    /**
     * Creates a checkout session at the payment provider and returns the URL
     * that the frontend should redirect to.
     *
     * @param params.pendingRegistrationId Stored as `client_reference_id` (or similar)
     *   in the provider — the webhook needs it to link back.
     * @param params.planId The chosen plan (Stripe price/product mapping lives
     *   in the adapter).
     * @param params.successUrl Where to go after successful payment.
     * @param params.cancelUrl Where to go on cancellation.
     */
    createCheckoutSession(params: {
        pendingRegistrationId: string;
        planId: string;
        email: string;
        successUrl: string;
        cancelUrl: string;
    }): Promise<CheckoutSession>;
}

/** Adapter port: OTP delivery via email (or another channel). */
export interface RegistrationOtpDelivery {
    sendVerificationOtp(params: {
        to: string;
        code: string;
        firstName: string;
        locale: string;
    }): Promise<void>;
}

/** Wire format for a publicly selectable plan in onboarding step 3. */
export interface PublicSignupPlan {
    id: string;
    name?: string;
    tagline?: string;
    monthlyNet: number | null;
    yearlyNet: number | null;
    popular?: boolean;
    features: string[];
}

/**
 * Adapter port: provides the plan selection for step 3 (package selection).
 *
 * Implementation must check BOTH:
 *  - Plan is marketable in the catalog (`marketed !== false`).
 *  - A published, non-superseded `PlanVersion` exists in the DB
 *    (otherwise the final `Subscription` cannot set a `planVersionId`).
 */
export interface PlanCatalogLookup {
    /** List of all public-signup-capable plans; empty if none. */
    listPublicSignupPlans(): Promise<PublicSignupPlan[]>;
    /** Detail lookup of a plan. null if not selectable (e.g. ENTERPRISE). */
    findPublicSignupPlan(planId: string): Promise<PublicSignupPlan | null>;
}

/** Input to PendingRegistrationService.start(). */
export interface StartRegistrationInput {
    tenantName: string;
    /** If null/undefined it is generated from tenantName. */
    tenantSlug?: string | null;
    salutation?: string | null;
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    locale?: string;
}

/** Result contract for the (account-enumeration-safe) start call. */
export interface StartRegistrationResult {
    /** Always true. Account-enumeration protection: no information about DB state to the outside. */
    neutral: true;
}

export interface VerifyRegistrationOtpResult {
    status: RegistrationStatus;
    nextStep: RegistrationStep;
    pendingRegistrationId: string;
}

export interface SelectPlanInput {
    pendingRegistrationId: string;
    planId: string;
}

export interface SelectPlanResult {
    pendingRegistrationId: string;
    status: RegistrationStatus;
    nextStep: RegistrationStep;
    selectedPlanId: string;
}

export interface StartCheckoutInput {
    pendingRegistrationId: string;
    successUrl: string;
    cancelUrl: string;
}

export interface StartCheckoutResult {
    pendingRegistrationId: string;
    status: RegistrationStatus;
    nextStep: RegistrationStep;
    checkoutSessionId: string;
    checkoutUrl: string;
}
