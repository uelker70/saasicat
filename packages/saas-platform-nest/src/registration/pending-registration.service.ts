import {
    BadRequestException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
} from '@nestjs/common';
import type {
    ActivationOrchestrator,
    CleanupResult,
    ConfiguratorCatalog,
    ConfiguratorPriceBreakdown,
    HandlePaymentEventInput,
    HandlePaymentEventResult,
    PaymentEventLog,
    PaymentProvider,
    PendingRegistration,
    PendingRegistrationRepository,
    PendingRegistrationSnapshot,
    PlanCatalogLookup,
    PublicSignupPlan,
    RegistrationAuditContext,
    RegistrationAuditEventType,
    RegistrationAuditLogger,
    RegistrationConfiguratorLookup,
    RegistrationOtpDelivery,
    RegistrationPromoPreview,
    RegistrationResumeDelivery,
    RegistrationResumeTokenSigner,
    ResumeRegistrationInput,
    ResumeRegistrationResult,
    SaveRegistrationConfigInput,
    SaveRegistrationConfigResult,
    SelectPlanInput,
    SelectPlanResult,
    SlugAvailabilityCheck,
    StartCheckoutInput,
    StartCheckoutResult,
    StartRegistrationInput,
    StartRegistrationResult,
    UserAccountLookup,
    VerifyRegistrationOtpResult,
} from '@saasicat/types';
import { REGISTRATION_RESUME_TTL_MINUTES } from '@saasicat/types';
import {
    OTP_RATE_LIMIT_MAX_SENDS,
    OTP_RATE_LIMIT_WINDOW_MINUTES,
    OTP_TTL_MINUTES,
    OTP_VERIFY_MAX_ATTEMPTS,
    PENDING_CHECKOUT_TTL_DAYS,
    PENDING_EMAIL_TTL_HOURS,
    PENDING_ONBOARDING_TTL_DAYS,
    REGISTRATION_STEP_BY_STATUS,
} from '@saasicat/types';
import { generateOtpCode, hashOtpCode, slugify, verifyOtpCode } from './helpers.js';
import { computeBreakdown } from './pricing.js';
import {
    ACTIVATION_ORCHESTRATOR_TOKEN,
    PASSWORD_HASHER_TOKEN,
    PAYMENT_EVENT_LOG_TOKEN,
    PAYMENT_PROVIDER_TOKEN,
    PENDING_REGISTRATION_REPOSITORY_TOKEN,
    PLAN_CATALOG_LOOKUP_TOKEN,
    REGISTRATION_AUDIT_LOGGER_TOKEN,
    REGISTRATION_CONFIGURATOR_LOOKUP_TOKEN,
    REGISTRATION_OTP_DELIVERY_TOKEN,
    REGISTRATION_PROMO_PREVIEW_TOKEN,
    REGISTRATION_RESUME_BASE_URL_TOKEN,
    REGISTRATION_RESUME_DELIVERY_TOKEN,
    REGISTRATION_RESUME_TOKEN_SIGNER_TOKEN,
    SLUG_AVAILABILITY_CHECK_TOKEN,
    USER_ACCOUNT_LOOKUP_TOKEN,
    type PasswordHasher,
} from './tokens.js';

/**
 * Orchestrates step 1 (capture registration data) and step 2 (OTP verification)
 * of the multi-step registration flow.
 *
 * Important invariants:
 *  - `start()` ALWAYS returns a neutral response (account-enumeration protection).
 *  - The OTP is only stored as a SHA-256 hash, never in plaintext.
 *  - Passwords are hashed by the injected PasswordHasher (usually Argon2).
 *  - On a rate-limit hit the OTP send is silently discarded — no 429 response,
 *    otherwise an attacker could infer the existence of a PendingRegistration
 *    record from the status code.
 *  - OTP failed attempts are counted persistently: at `OTP_VERIFY_MAX_ATTEMPTS`
 *    `verifyOtp()` throws `OTP_LOCKED` — even for a subsequently correct code.
 *    Only a newly generated OTP (resend, rate-limited separately) unlocks it.
 */
@Injectable()
export class PendingRegistrationService {
    private readonly logger = new Logger(PendingRegistrationService.name);

    constructor(
        @Inject(PENDING_REGISTRATION_REPOSITORY_TOKEN)
        private readonly repo: PendingRegistrationRepository,
        @Inject(REGISTRATION_OTP_DELIVERY_TOKEN)
        private readonly otpDelivery: RegistrationOtpDelivery,
        @Inject(USER_ACCOUNT_LOOKUP_TOKEN)
        private readonly userLookup: UserAccountLookup,
        @Inject(SLUG_AVAILABILITY_CHECK_TOKEN)
        private readonly slugCheck: SlugAvailabilityCheck,
        @Inject(PASSWORD_HASHER_TOKEN)
        private readonly passwordHasher: PasswordHasher,
        @Inject(PLAN_CATALOG_LOOKUP_TOKEN)
        private readonly planCatalog: PlanCatalogLookup,
        @Inject(PAYMENT_PROVIDER_TOKEN)
        private readonly paymentProvider: PaymentProvider,
        @Inject(PAYMENT_EVENT_LOG_TOKEN)
        private readonly paymentEventLog: PaymentEventLog,
        @Inject(ACTIVATION_ORCHESTRATOR_TOKEN)
        private readonly activationOrchestrator: ActivationOrchestrator,
        @Inject(REGISTRATION_AUDIT_LOGGER_TOKEN)
        private readonly audit: RegistrationAuditLogger,
        @Optional()
        @Inject(REGISTRATION_RESUME_TOKEN_SIGNER_TOKEN)
        private readonly resumeTokenSigner?: RegistrationResumeTokenSigner,
        @Optional()
        @Inject(REGISTRATION_RESUME_DELIVERY_TOKEN)
        private readonly resumeDelivery?: RegistrationResumeDelivery,
        @Optional()
        @Inject(REGISTRATION_RESUME_BASE_URL_TOKEN)
        private readonly resumeBaseUrl?: string,
        @Optional()
        @Inject(REGISTRATION_CONFIGURATOR_LOOKUP_TOKEN)
        private readonly configuratorLookup?: RegistrationConfiguratorLookup,
        @Optional()
        @Inject(REGISTRATION_PROMO_PREVIEW_TOKEN)
        private readonly promoPreview?: RegistrationPromoPreview,
    ) {}

    private async record(
        eventType: RegistrationAuditEventType,
        pendingRegistrationId: string | null,
        context?: RegistrationAuditContext,
        metadata?: Record<string, unknown>,
    ): Promise<void> {
        try {
            await this.audit.log({
                eventType,
                pendingRegistrationId,
                context,
                metadata,
            });
        } catch (error) {
            // Audit failure must not abort the auth flow.
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Audit-Log fehlgeschlagen (${eventType}): ${message}`);
        }
    }

    /** Public signup plan list for step 3 (frontend `usePublicPlans()`). */
    async listPublicPlans(): Promise<PublicSignupPlan[]> {
        return this.planCatalog.listPublicSignupPlans();
    }

    async selectPlan(
        input: SelectPlanInput,
        context?: RegistrationAuditContext,
    ): Promise<SelectPlanResult> {
        const pending = await this.repo.findById(input.pendingRegistrationId);
        if (!pending) {
            throw new NotFoundException({ code: 'PENDING_REGISTRATION_NOT_FOUND' });
        }
        if (pending.expiresAt.getTime() < Date.now()) {
            throw new BadRequestException({ code: 'PENDING_REGISTRATION_EXPIRED' });
        }
        // A plan can only be selected after email verification and before
        // activation has completed. Switching plans in status PLAN_SELECTED /
        // CHECKOUT_STARTED is allowed — the spec permits switching until payment.
        if (
            pending.status !== 'EMAIL_VERIFIED' &&
            pending.status !== 'PLAN_SELECTED' &&
            pending.status !== 'CHECKOUT_STARTED'
        ) {
            throw new BadRequestException({ code: 'INVALID_REGISTRATION_STATE' });
        }

        const plan = await this.planCatalog.findPublicSignupPlan(input.planId);
        if (!plan) {
            // The plan does not exist in the catalog OR is not eligible for public
            // signup (e.g. ENTERPRISE). Both cases return the same response so that
            // plan existence does not leak via differing error codes.
            throw new BadRequestException({ code: 'PLAN_NOT_AVAILABLE' });
        }

        const now = new Date();
        const expiresAt = new Date(
            now.getTime() + PENDING_ONBOARDING_TTL_DAYS * 24 * 60 * 60 * 1000,
        );
        const updated = await this.repo.update(pending.id, {
            status: 'PLAN_SELECTED',
            currentStep: 4,
            selectedPlanId: plan.id,
            expiresAt,
        });
        await this.record('PLAN_SELECTED', updated.id, context, { planId: plan.id });
        return {
            pendingRegistrationId: updated.id,
            status: updated.status,
            nextStep: REGISTRATION_STEP_BY_STATUS[updated.status],
            selectedPlanId: updated.selectedPlanId ?? plan.id,
        };
    }

    async startCheckout(
        input: StartCheckoutInput,
        context?: RegistrationAuditContext,
    ): Promise<StartCheckoutResult> {
        const pending = await this.repo.findById(input.pendingRegistrationId);
        if (!pending) {
            throw new NotFoundException({ code: 'PENDING_REGISTRATION_NOT_FOUND' });
        }
        if (pending.expiresAt.getTime() < Date.now()) {
            throw new BadRequestException({ code: 'PENDING_REGISTRATION_EXPIRED' });
        }
        if (pending.status !== 'PLAN_SELECTED' && pending.status !== 'CHECKOUT_STARTED') {
            throw new BadRequestException({ code: 'PLAN_NOT_SELECTED' });
        }
        if (!pending.selectedPlanId) {
            throw new BadRequestException({ code: 'PLAN_NOT_SELECTED' });
        }
        // Security re-check: the plan could have been removed from the catalog
        // between step 3 and step 4 (e.g. a maintenance window).
        const plan = await this.planCatalog.findPublicSignupPlan(pending.selectedPlanId);
        if (!plan) {
            throw new BadRequestException({ code: 'PLAN_NOT_AVAILABLE' });
        }

        const session = await this.paymentProvider.createCheckoutSession({
            pendingRegistrationId: pending.id,
            planId: pending.selectedPlanId,
            email: pending.email,
            successUrl: input.successUrl,
            cancelUrl: input.cancelUrl,
        });

        const now = new Date();
        const expiresAt = new Date(now.getTime() + PENDING_CHECKOUT_TTL_DAYS * 24 * 60 * 60 * 1000);
        const updated = await this.repo.update(pending.id, {
            status: 'CHECKOUT_STARTED',
            currentStep: 4,
            checkoutSessionId: session.sessionId,
            checkoutStartedAt: now,
            expiresAt,
        });

        await this.record('CHECKOUT_STARTED', updated.id, context, {
            sessionId: session.sessionId,
            provider: session.provider,
        });
        return {
            pendingRegistrationId: updated.id,
            status: updated.status,
            nextStep: REGISTRATION_STEP_BY_STATUS[updated.status],
            checkoutSessionId: session.sessionId,
            checkoutUrl: session.checkoutUrl,
        };
    }

    /**
     * Processes a payment webhook idempotently:
     *  1. `tryClaim` pins the event ID via a @unique INSERT. Duplicates are
     *     dropped silently (`ALREADY_PROCESSED`).
     *  2. On status `SUCCEEDED` the PendingRegistration is resolved from the
     *     checkout session and the ActivationOrchestrator triggers the final
     *     user+tenant+subscription creation in a single transaction.
     *  3. After activation the PendingRegistration is deleted.
     *
     * On errors in step 2/3 the EventLog entry remains — provider retries then
     * run into ALREADY_PROCESSED. Operational repair is done manually (status
     * inspection + cleanup).
     */
    async handlePaymentEvent(
        input: HandlePaymentEventInput,
        context?: RegistrationAuditContext,
    ): Promise<HandlePaymentEventResult> {
        const claimed = await this.paymentEventLog.tryClaim(input.eventId, {
            provider: input.provider,
            sessionId: input.sessionId,
            status: input.status,
            rawPayload: input.rawPayload,
        });
        if (!claimed) {
            this.logger.warn(
                `Idempotenz: PaymentEvent ${input.eventId} bereits verarbeitet — Duplikat verworfen.`,
            );
            await this.record('PAYMENT_DUPLICATE_IGNORED', null, context, {
                eventId: input.eventId,
                sessionId: input.sessionId,
            });
            return { activated: false, reason: 'ALREADY_PROCESSED' };
        }
        if (input.status !== 'SUCCEEDED') {
            await this.record('PAYMENT_FAILED', null, context, {
                eventId: input.eventId,
                sessionId: input.sessionId,
            });
            return { activated: false, reason: 'PAYMENT_NOT_SUCCEEDED' };
        }
        if (!input.sessionId) {
            return { activated: false, reason: 'MISSING_SESSION_ID' };
        }
        const pending = await this.repo.findByCheckoutSession(input.sessionId);
        if (!pending) {
            return { activated: false, reason: 'PENDING_REGISTRATION_NOT_FOUND' };
        }
        // Allow PLAN_SELECTED: if the webhook arrives *before* the startCheckout
        // update roundtrip (race), the status would still be PLAN_SELECTED.
        // CHECKOUT_STARTED is the standard case.
        if (pending.status !== 'CHECKOUT_STARTED' && pending.status !== 'PLAN_SELECTED') {
            return { activated: false, reason: 'INVALID_STATE' };
        }

        await this.record('PAYMENT_RECEIVED', pending.id, context, {
            eventId: input.eventId,
            sessionId: input.sessionId,
        });
        const result = await this.activationOrchestrator.activate(pending);
        await this.repo.delete(pending.id);
        await this.record('ACTIVATION_COMPLETED', pending.id, context, {
            userId: result.userId,
            tenantId: result.tenantId,
            subscriptionId: result.subscriptionId,
        });

        this.logger.log(
            `Aktivierung erfolgreich: pending=${pending.id} → user=${result.userId} tenant=${result.tenantId} subscription=${result.subscriptionId}`,
        );
        return { activated: true, result };
    }

    /**
     * Deletes all PendingRegistration records with `expiresAt < now`.
     * Full deletion (no anonymization path) is the simpler option: the schema
     * holds `email`, `firstName`, `lastName`, `passwordHash` as NOT NULL, and
     * the unique email is exactly what needs to become free again after expiry.
     *
     * The batch `limit` guards against memory spikes on large backlogs — the
     * caller (cron) keeps calling until `moreAvailable === false`.
     */
    async runCleanup(now: Date, limit = 500): Promise<CleanupResult> {
        if (limit <= 0) {
            return { deleted: 0, moreAvailable: false };
        }
        const expired = await this.repo.findExpired(now, limit);
        for (const pending of expired) {
            try {
                await this.repo.delete(pending.id);
            } catch (error) {
                // Do not escalate delete errors — e.g. a concurrent cleanup has
                // already removed the record. Log and continue.
                const message = error instanceof Error ? error.message : String(error);
                this.logger.warn(
                    `Cleanup: PendingRegistration ${pending.id} konnte nicht geloescht werden (${message}).`,
                );
            }
        }
        if (expired.length > 0) {
            this.logger.log(
                `Cleanup: ${expired.length} abgelaufene PendingRegistrations geloescht.`,
            );
        }
        return {
            deleted: expired.length,
            moreAvailable: expired.length >= limit,
        };
    }

    async start(
        input: StartRegistrationInput,
        context?: RegistrationAuditContext,
    ): Promise<StartRegistrationResult> {
        const email = normalizeEmail(input.email);

        if (await this.userLookup.hasActiveUser(email)) {
            // Case A: an active account exists. Do not create a PendingRegistration,
            // do not reveal any information to the outside. Optionally a password
            // reset link could be sent here (phase 2+).
            this.logger.log(`register/start fuer aktiven Account ignoriert (${email}).`);
            await this.record('REGISTRATION_NEUTRAL_ACTIVE_USER', null, context);
            return { neutral: true };
        }

        const existing = await this.repo.findByEmail(email);
        if (existing) {
            if (existing.expiresAt.getTime() < Date.now()) {
                // Case E: expired. Delete and create fresh below.
                await this.repo.delete(existing.id);
                await this.record('REGISTRATION_NEUTRAL_EXPIRED', existing.id, context);
            } else if (existing.status === 'PENDING_EMAIL_VERIFICATION') {
                // Case B: an unconfirmed registration is in progress. New OTP,
                // the old one is invalidated. Other fields stay unchanged
                // (no override by a potential attacker).
                await this.regenerateOtp(existing);
                await this.record('REGISTRATION_NEUTRAL_REPLAY', existing.id, context, {
                    status: existing.status,
                });
                return { neutral: true };
            } else {
                // Case C/D: onboarding has already progressed (EMAIL_VERIFIED,
                // PLAN_SELECTED, CHECKOUT_STARTED). Spec § case C/D: we send a
                // *resume link* with a signed token, no new OTP — the user
                // should not have to verify again.
                // Fallback (no signer configured): regenerateOtp as in case B.
                if (this.resumeTokenSigner && this.resumeDelivery) {
                    await this.sendResumeLink(existing);
                } else {
                    await this.regenerateOtp(existing);
                }
                await this.record('REGISTRATION_NEUTRAL_REPLAY', existing.id, context, {
                    status: existing.status,
                });
                return { neutral: true };
            }
        }

        const slug = await this.resolveSlug(input.tenantName, input.tenantSlug);
        const passwordHash = await this.passwordHasher.hash(input.password);
        const code = generateOtpCode();
        const otpHash = hashOtpCode(code);
        const now = new Date();
        const otpExpiresAt = new Date(now.getTime() + OTP_TTL_MINUTES * 60 * 1000);
        const expiresAt = new Date(now.getTime() + PENDING_EMAIL_TTL_HOURS * 60 * 60 * 1000);

        const pending = await this.repo.create({
            tenantName: input.tenantName.trim(),
            tenantSlug: slug,
            salutation: nullable(input.salutation),
            firstName: input.firstName.trim(),
            lastName: input.lastName.trim(),
            email,
            passwordHash,
            locale: input.locale ?? 'de',
            otpHash,
            otpExpiresAt,
            expiresAt,
        });

        await this.deliverOtp(pending, code);
        await this.record('REGISTRATION_STARTED', pending.id, context);
        return { neutral: true };
    }

    async verifyOtp(
        emailRaw: string,
        code: string,
        context?: RegistrationAuditContext,
    ): Promise<VerifyRegistrationOtpResult> {
        const email = normalizeEmail(emailRaw);
        const pending = await this.repo.findByEmail(email);
        if (!pending) {
            await this.record('OTP_VERIFY_FAILED', null, context, { reason: 'unknown_email' });
            throw new BadRequestException({ code: 'OTP_INVALID' });
        }

        if (pending.status !== 'PENDING_EMAIL_VERIFICATION') {
            // Already verified: idempotent response with the current step.
            // (Prevents errors when the frontend sends a verify call twice.)
            return {
                status: pending.status,
                nextStep: REGISTRATION_STEP_BY_STATUS[pending.status],
                pendingRegistrationId: pending.id,
            };
        }

        if (!pending.otpHash || !pending.otpExpiresAt) {
            await this.record('OTP_VERIFY_FAILED', pending.id, context, { reason: 'no_otp_set' });
            throw new BadRequestException({ code: 'OTP_INVALID' });
        }
        if (pending.otpExpiresAt.getTime() < Date.now()) {
            await this.record('OTP_VERIFY_FAILED', pending.id, context, { reason: 'expired' });
            throw new BadRequestException({ code: 'OTP_EXPIRED' });
        }
        // Brute-force lockout as claim-then-check: first atomically claim an
        // attempt slot, THEN compare — this hard-caps the number of hash
        // comparisons per code even under concurrent requests. The upfront
        // check on the read state is just the shortcut that spares already
        // locked codes the increment.
        const maxAttempts = resolveOtpVerifyMaxAttempts();
        if (pending.otpAttemptCount >= maxAttempts) {
            await this.record('OTP_VERIFY_FAILED', pending.id, context, { reason: 'locked' });
            throw new BadRequestException({ code: 'OTP_LOCKED' });
        }
        // `newCount > limit` means: the counter was already at the limit BEFORE
        // this attempt — a concurrent request has already used up the budget;
        // this request gets no more hash comparison.
        const attemptCount = await this.repo.incrementOtpAttemptCount(pending.id);
        if (attemptCount > maxAttempts) {
            await this.record('OTP_VERIFY_FAILED', pending.id, context, { reason: 'locked' });
            throw new BadRequestException({ code: 'OTP_LOCKED' });
        }
        if (!verifyOtpCode(pending.otpHash, code)) {
            await this.record('OTP_VERIFY_FAILED', pending.id, context, { reason: 'wrong_code' });
            throw new BadRequestException({ code: 'OTP_INVALID' });
        }

        const now = new Date();
        const updated = await this.repo.update(pending.id, {
            status: 'EMAIL_VERIFIED',
            currentStep: 3,
            emailVerifiedAt: now,
            otpHash: null,
            otpExpiresAt: null,
            expiresAt: new Date(now.getTime() + PENDING_ONBOARDING_TTL_DAYS * 24 * 60 * 60 * 1000),
        });
        await this.record('OTP_VERIFIED', updated.id, context);

        return {
            status: updated.status,
            nextStep: REGISTRATION_STEP_BY_STATUS[updated.status],
            pendingRegistrationId: updated.id,
        };
    }

    async resendOtp(
        emailRaw: string,
        context?: RegistrationAuditContext,
    ): Promise<StartRegistrationResult> {
        const email = normalizeEmail(emailRaw);
        const pending = await this.repo.findByEmail(email);
        // Account-enumeration protection: whether a record exists or not — same response.
        if (!pending) {
            return { neutral: true };
        }
        if (pending.status !== 'PENDING_EMAIL_VERIFICATION') {
            // If they are already further along, we still send a new OTP for the sake
            // of UX (e.g. when the user clicks "Neuen Code senden" and then sends
            // twice). Other statuses are not an error, but no OTP is sent.
            return { neutral: true };
        }
        await this.regenerateOtp(pending);
        await this.record('OTP_RESEND_REQUESTED', pending.id, context);
        return { neutral: true };
    }

    private async regenerateOtp(pending: PendingRegistration): Promise<void> {
        const now = new Date();
        const windowMs = OTP_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000;
        const withinWindow =
            pending.lastOtpSentAt !== null &&
            now.getTime() - pending.lastOtpSentAt.getTime() < windowMs;

        if (withinWindow && pending.otpSendCount >= OTP_RATE_LIMIT_MAX_SENDS) {
            this.logger.warn(
                `OTP-Rate-Limit erreicht fuer ${pending.email} — Send wird still verworfen.`,
            );
            return;
        }

        const code = generateOtpCode();
        const otpHash = hashOtpCode(code);
        const otpExpiresAt = new Date(now.getTime() + OTP_TTL_MINUTES * 60 * 1000);
        const otpSendCount = withinWindow ? pending.otpSendCount + 1 : 1;

        await this.repo.update(pending.id, {
            otpHash,
            otpExpiresAt,
            otpSendCount,
            lastOtpSentAt: now,
            // New code = fresh attempt budget. Overall throughput stays capped
            // by the send rate limit above.
            otpAttemptCount: 0,
        });

        await this.deliverOtp(pending, code);
    }

    private async deliverOtp(pending: PendingRegistration, code: string): Promise<void> {
        try {
            await this.otpDelivery.sendVerificationOtp({
                to: pending.email,
                code,
                firstName: pending.firstName,
                locale: pending.locale,
            });
        } catch (error) {
            // A mail send error must not noticeably abort the flow (otherwise
            // account enumeration via timing/status code). Only log.
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`OTP-Mail an ${pending.email} fehlgeschlagen: ${message}`);
        }
    }

    /**
     * Creates a signed resume token (60 min TTL) and sends a magic link to the
     * stored email. Mail send errors are logged but not escalated
     * (account-enumeration protection).
     */
    private async sendResumeLink(pending: PendingRegistration): Promise<void> {
        if (!this.resumeTokenSigner || !this.resumeDelivery) {
            return;
        }
        const token = await this.resumeTokenSigner.sign({
            pendingRegistrationId: pending.id,
            ttlMinutes: REGISTRATION_RESUME_TTL_MINUTES,
        });
        const base = (this.resumeBaseUrl ?? 'http://localhost').replace(/\/+$/, '');
        const url = `${base}/login?resume=${encodeURIComponent(token)}`;
        try {
            await this.resumeDelivery.sendResumeEmail({
                to: pending.email,
                firstName: pending.firstName,
                locale: pending.locale,
                resumeUrl: url,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`Resume-Mail an ${pending.email} fehlgeschlagen: ${message}`);
        }
    }

    /**
     * Resolves a resume token to the matching onboarding step. Called by the
     * frontend from `/register?resume=<jwt>`. On an invalid token the method
     * throws `RESUME_TOKEN_INVALID`.
     *
     * Also returns a public-safe snapshot of the PendingRegistration so the
     * frontend can prefill completed steps with the existing data (first name /
     * last name, organization name, plan selection ...).
     */
    async resumeWithToken(
        input: ResumeRegistrationInput,
        context?: RegistrationAuditContext,
    ): Promise<ResumeRegistrationResult> {
        if (!this.resumeTokenSigner) {
            throw new BadRequestException({ code: 'RESUME_NOT_CONFIGURED' });
        }
        let decoded: { pendingRegistrationId: string };
        try {
            decoded = await this.resumeTokenSigner.verify(input.token);
        } catch {
            throw new BadRequestException({ code: 'RESUME_TOKEN_INVALID' });
        }
        const pending = await this.repo.findById(decoded.pendingRegistrationId);
        if (!pending) {
            throw new BadRequestException({ code: 'RESUME_TOKEN_INVALID' });
        }
        if (pending.expiresAt.getTime() < Date.now()) {
            throw new BadRequestException({ code: 'PENDING_REGISTRATION_EXPIRED' });
        }
        await this.record('REGISTRATION_NEUTRAL_REPLAY', pending.id, context, {
            via: 'resume_token',
            status: pending.status,
        });
        return {
            pendingRegistrationId: pending.id,
            status: pending.status,
            nextStep: REGISTRATION_STEP_BY_STATUS[pending.status],
            snapshot: toSnapshot(pending),
        };
    }

    /**
     * Signs a short-lived resume token for an existing PendingRegistration —
     * the login endpoint uses this to send the user into the wizard with
     * prefill after successful password verification.
     */
    async signResumeToken(pendingRegistrationId: string): Promise<string | null> {
        if (!this.resumeTokenSigner) return null;
        return this.resumeTokenSigner.sign({ pendingRegistrationId });
    }

    /* ─── Configurator (Step 3) ────────────────────────────────────────── */

    /** Returns the (app-specific) configurator catalog. */
    async getConfiguratorCatalog(): Promise<ConfiguratorCatalog> {
        if (!this.configuratorLookup) {
            throw new BadRequestException({ code: 'CONFIGURATOR_NOT_CONFIGURED' });
        }
        return this.configuratorLookup.getCatalog();
    }

    /**
     * Saves the configurator selection (model + cycle + promo) and returns the
     * full price breakdown.
     *
     * Sets:
     *  - `status = PLAN_SELECTED`
     *  - `currentStep = 4`
     *  - `selectedPlanId = <planId from the chosen model>`
     *  - `configJson` / `billingCycle` / `appliedPromoCode`
     *  - `expiresAt = now + ONBOARDING_TTL`
     */
    async saveConfiguration(
        input: SaveRegistrationConfigInput,
        context?: RegistrationAuditContext,
    ): Promise<SaveRegistrationConfigResult> {
        if (!this.configuratorLookup) {
            throw new BadRequestException({ code: 'CONFIGURATOR_NOT_CONFIGURED' });
        }
        const pending = await this.repo.findById(input.pendingRegistrationId);
        if (!pending) {
            throw new NotFoundException({ code: 'PENDING_REGISTRATION_NOT_FOUND' });
        }
        if (pending.expiresAt.getTime() < Date.now()) {
            throw new BadRequestException({ code: 'PENDING_REGISTRATION_EXPIRED' });
        }
        if (
            pending.status !== 'EMAIL_VERIFIED' &&
            pending.status !== 'PLAN_SELECTED' &&
            pending.status !== 'CHECKOUT_STARTED'
        ) {
            throw new BadRequestException({ code: 'INVALID_REGISTRATION_STATE' });
        }

        const catalog = await this.configuratorLookup.getCatalog();
        const model = catalog.models.find((m) => m.id === input.selection.modelId);
        if (!model) {
            throw new BadRequestException({ code: 'MODEL_NOT_AVAILABLE' });
        }

        // Promo code optional: when present, run it against the preview adapter.
        let promoEval: { discountAmount: number; percent: number; label: string } | undefined;
        if (input.selection.appliedPromoCode && this.promoPreview) {
            // First compute without the promo to get the gross subtotal.
            const dryRun = computeBreakdown(catalog, {
                ...input.selection,
                appliedPromoCode: null,
            });
            const previewResult = await this.promoPreview.preview({
                code: input.selection.appliedPromoCode,
                planId: model.planId,
                billingCycle: input.selection.billingCycle,
                subtotalGross: dryRun.totalGross,
                email: pending.email,
            });
            if (
                previewResult.valid &&
                previewResult.discountAmount &&
                previewResult.percent !== undefined &&
                previewResult.label
            ) {
                promoEval = {
                    discountAmount: previewResult.discountAmount,
                    percent: previewResult.percent,
                    label: previewResult.label,
                };
            }
        }

        const breakdown = computeBreakdown(catalog, input.selection, promoEval);
        if (promoEval) {
            breakdown.appliedPromo = {
                code: input.selection.appliedPromoCode!,
                label: promoEval.label,
                percent: promoEval.percent,
            };
        }

        const now = new Date();
        const expiresAt = new Date(
            now.getTime() + PENDING_ONBOARDING_TTL_DAYS * 24 * 60 * 60 * 1000,
        );
        const updated = await this.repo.update(pending.id, {
            status: 'PLAN_SELECTED',
            currentStep: 4,
            selectedPlanId: model.planId,
            configJson: input.selection,
            billingCycle: input.selection.billingCycle,
            appliedPromoCode: input.selection.appliedPromoCode ?? null,
            expiresAt,
        });

        await this.record('PLAN_SELECTED', updated.id, context, {
            modelId: model.id,
            planId: model.planId,
            cycle: input.selection.billingCycle,
            hasPromo: !!promoEval,
        });

        return {
            pendingRegistrationId: updated.id,
            status: updated.status,
            nextStep: REGISTRATION_STEP_BY_STATUS[updated.status],
            selection: input.selection,
            breakdown,
        };
    }

    /**
     * Validates a promo code against the currently stored configuration and
     * returns a new breakdown. Does NOT modify the pending — for live preview
     * in the frontend. If `null` is passed as `code`, the promo effect is
     * removed.
     */
    async previewConfigPromo(
        pendingRegistrationId: string,
        code: string | null,
    ): Promise<ConfiguratorPriceBreakdown> {
        if (!this.configuratorLookup) {
            throw new BadRequestException({ code: 'CONFIGURATOR_NOT_CONFIGURED' });
        }
        const pending = await this.repo.findById(pendingRegistrationId);
        if (!pending) {
            throw new NotFoundException({ code: 'PENDING_REGISTRATION_NOT_FOUND' });
        }
        const config = pending.configJson;
        if (!config) {
            throw new BadRequestException({ code: 'CONFIG_NOT_SAVED' });
        }
        const catalog = await this.configuratorLookup.getCatalog();
        const model = catalog.models.find((m) => m.id === config.modelId);
        if (!model) {
            throw new BadRequestException({ code: 'MODEL_NOT_AVAILABLE' });
        }

        let promoEval: { discountAmount: number; percent: number; label: string } | undefined;
        if (code && this.promoPreview) {
            const dryRun = computeBreakdown(catalog, { ...config, appliedPromoCode: null });
            const previewResult = await this.promoPreview.preview({
                code,
                planId: model.planId,
                billingCycle: config.billingCycle,
                subtotalGross: dryRun.totalGross,
                email: pending.email,
            });
            if (
                previewResult.valid &&
                previewResult.discountAmount &&
                previewResult.percent !== undefined &&
                previewResult.label
            ) {
                promoEval = {
                    discountAmount: previewResult.discountAmount,
                    percent: previewResult.percent,
                    label: previewResult.label,
                };
            }
        }

        const breakdown = computeBreakdown(catalog, config, promoEval);
        if (promoEval && code) {
            breakdown.appliedPromo = { code, label: promoEval.label, percent: promoEval.percent };
        }
        return breakdown;
    }

    /**
     * Helper for step 3 resume: the frontend needs the current breakdown when
     * the pending already has a configuration. Pure recomputation against the
     * catalog (without promo validation, since promos should be freshly checked
     * anyway).
     */
    async getCurrentBreakdown(
        pendingRegistrationId: string,
    ): Promise<ConfiguratorPriceBreakdown | null> {
        if (!this.configuratorLookup) return null;
        const pending = await this.repo.findById(pendingRegistrationId);
        if (!pending || !pending.configJson) return null;
        const catalog = await this.configuratorLookup.getCatalog();
        return computeBreakdown(catalog, pending.configJson);
    }

    private async resolveSlug(tenantName: string, requested?: string | null): Promise<string> {
        const requestedSlug = requested?.trim().toLowerCase() ?? '';
        const base = requestedSlug.length > 0 ? requestedSlug : slugify(tenantName);

        if (await this.slugCheck.isSlugAvailable(base)) {
            return base;
        }
        for (let i = 2; i < 1000; i++) {
            const candidate = `${base}-${i}`;
            if (await this.slugCheck.isSlugAvailable(candidate)) {
                return candidate;
            }
        }
        throw new Error(`Konnte keinen freien Slug fuer "${tenantName}" finden.`);
    }
}

function normalizeEmail(value: string): string {
    return value.trim().toLowerCase();
}

/**
 * Max OTP failed attempts: platform default from the registration constants,
 * overridable via the env `SAAS_PLATFORM_OTP_VERIFY_MAX_ATTEMPTS`. Read on each
 * call (analogous to `SAAS_PLATFORM_SKIP_RATE_LIMITS` in the IP guard), so that
 * consumers/tests can reconfigure without a restart.
 */
function resolveOtpVerifyMaxAttempts(): number {
    const raw = process.env.SAAS_PLATFORM_OTP_VERIFY_MAX_ATTEMPTS;
    if (!raw) return OTP_VERIFY_MAX_ATTEMPTS;
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : OTP_VERIFY_MAX_ATTEMPTS;
}

function toSnapshot(pending: PendingRegistration): PendingRegistrationSnapshot {
    return {
        tenantName: pending.tenantName,
        tenantSlug: pending.tenantSlug,
        salutation: pending.salutation,
        firstName: pending.firstName,
        lastName: pending.lastName,
        email: pending.email,
        locale: pending.locale,
        status: pending.status,
        currentStep: pending.currentStep,
        emailVerifiedAt: pending.emailVerifiedAt?.toISOString() ?? null,
        selectedPlanId: pending.selectedPlanId,
        config: pending.configJson,
        billingCycle: pending.billingCycle,
        appliedPromoCode: pending.appliedPromoCode,
        checkoutSessionId: pending.checkoutSessionId,
    };
}

function nullable(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : null;
}
