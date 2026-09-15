// Registration / PendingRegistration — Multi-step registration and
// onboarding flow.
//
// A PendingRegistration holds the intermediate state between step 1
// (capturing sign-up data) and the final activation (step 4: the billing
// address and the payment method). Only once the payment gateway confirmed the
// payment method does it become User + Tenant + Subscriber + Subscription.
// Until then the record stays decoupled from the production user model.

import type { TransactionContext } from './ports/core-ports.types.js';

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

    /**
     * The billing address and tax identifiers step 4 asks for, which the
     * subscriber is created with. The address is required before a payment
     * method is set up; the tax identifiers stay optional.
     */
    addressLine1: string | null;
    addressLine2: string | null;
    postalCode: string | null;
    city: string | null;
    /** ISO 3166-1 alpha-2, upper case. */
    country: string | null;
    vatId: string | null;
    taxNumber: string | null;

    /** The gateway's session for the payment method, unique within `checkoutGatewayAccount`. */
    checkoutSessionId: string | null;
    /** The account in `config/saas.yaml#payments.accounts` the session was opened at. */
    checkoutGatewayAccount: string | null;
    /** The customer the gateway created for the sign-up, reused when step 4 is repeated. */
    gatewayCustomerRef: string | null;
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
    addressLine1?: string | null;
    addressLine2?: string | null;
    postalCode?: string | null;
    city?: string | null;
    country?: string | null;
    vatId?: string | null;
    taxNumber?: string | null;
    checkoutSessionId?: string | null;
    checkoutGatewayAccount?: string | null;
    gatewayCustomerRef?: string | null;
    checkoutStartedAt?: Date | null;
    expiresAt?: Date;
}

/** Adapter port: persistence for PendingRegistration (CRUD). */
export interface PendingRegistrationRepository {
    findById(id: string): Promise<PendingRegistration | null>;
    findByEmail(email: string): Promise<PendingRegistration | null>;
    /**
     * Finds the pending record a gateway session belongs to. A session
     * identifier is unique only within its account, so both are matched.
     */
    findByCheckoutSession(
        gatewayAccount: string,
        sessionId: string,
    ): Promise<PendingRegistration | null>;
    /**
     * Cleanup lookup: all pending records with `expiresAt < now`, max
     * `limit` entries per call (batch protection). Ordering irrelevant, the
     * cron service iterates sequentially.
     */
    findExpired(now: Date, limit: number): Promise<PendingRegistration[]>;
    /**
     * Every gateway account a checkout session is still open at: the distinct
     * `checkoutGatewayAccount` of records in `CHECKOUT_STARTED` whose
     * `expiresAt` is after `now`. The start refuses when one of them is no
     * longer configured, because that sign-up's confirmation could not arrive.
     */
    findOpenCheckoutAccounts(now: Date): Promise<string[]>;
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

export interface FinalActivationResult {
    userId: string;
    tenantId: string;
    subscriptionId: string;
    /**
     * The subscriber created for the tenant in the same transaction — the party
     * its contracts are concluded with. `subscriberFromRegistration(pending)`
     * says what it is created with.
     */
    subscriberId: string;
}

/** The transaction a sign-up is activated on. */
export interface RegistrationActivation {
    /**
     * Opened by the platform, which has already claimed the gateway's
     * confirmation on it and records the confirmed payment method on it once
     * `activate` returns. Every row the activation writes goes through it, so
     * a failure anywhere rolls back all of it — the claim included, and the
     * gateway's retry is handled rather than discarded as a duplicate.
     */
    tx: TransactionContext;
}

/**
 * Adapter port: creates User + Tenant + Subscriber + Subscription once the
 * gateway confirmed the sign-up's payment method. App-specific — each app has
 * its own schema (e.g. Tenant + TenantUser + Role + UserRole + Subscription).
 *
 * Implementations write on `activation.tx` and open no transaction of their
 * own: a write beside it would survive the rollback that undoes the rest. The
 * subscriber is created there too, before any contract:
 * `SubscriberService.createForTenant(tenantId, subscriberFromRegistration(pending),
 * activation.tx)`, or `CheckoutOfferService.conclude` with `subscriber` and
 * that transaction.
 */
export interface ActivationOrchestrator {
    activate(
        pending: PendingRegistration,
        activation: RegistrationActivation,
    ): Promise<FinalActivationResult>;
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
    currency: string;
    vatRate: number;
    models: ConfiguratorModel[];
}

export interface RegistrationConfigSelection {
    modelId: string;
    billingCycle: 'MONTHLY' | 'YEARLY';
    appliedPromoCode: string | null;
    /**
     * P11.4: preselected CheckoutOffer from the website
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
    /**
     * Net amount taken off `subtotalNet`: the promo preview's gross discount
     * converted at `vatRate`.
     */
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
 * `@saasicat/nest/billing`. The builder combines SuperAdmin DB data
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
 * (display name, glyph, tagline) is branding and lives in the app.
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
    getVatRate(): number;
    getCurrency(): string;
}

/**
 * Adapter port: promo-code preview against a gross subtotal.
 * Typically wraps `@saasicat/nest/promo:PromoCodesService.preview()`.
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
        /** The discount in gross, reckoned against `subtotalGross`. */
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
    /** The billing details step 4 already took, to fill its form again. */
    billingDetails: RegistrationBillingDetails | null;
    checkoutSessionId: string | null;
}

export interface ResumeRegistrationResult {
    pendingRegistrationId: string;
    status: RegistrationStatus;
    nextStep: RegistrationStep;
    snapshot: PendingRegistrationSnapshot;
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

/**
 * The billing address and tax identifiers a sign-up gives in step 4, which its
 * subscriber is created with. The address is required; the tax identifiers
 * stay optional until the tax adapter says when one is needed.
 */
export interface RegistrationBillingDetails {
    addressLine1: string;
    addressLine2?: string | null;
    postalCode: string;
    city: string;
    /** ISO 3166-1 alpha-2, upper case. */
    country: string;
    vatId?: string | null;
    taxNumber?: string | null;
}

export interface StartCheckoutInput {
    pendingRegistrationId: string;
    billingDetails: RegistrationBillingDetails;
    /** Where the gateway's form sends the person once the payment method is set up. */
    successUrl: string;
    /** Where the gateway's form sends the person who leaves it. */
    cancelUrl: string;
}

export interface StartCheckoutResult {
    pendingRegistrationId: string;
    status: RegistrationStatus;
    nextStep: RegistrationStep;
    checkoutSessionId: string;
    checkoutUrl: string;
}
