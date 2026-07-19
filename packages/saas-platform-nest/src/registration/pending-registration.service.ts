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
    RegistrationBusinessTypeLookup,
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
    REGISTRATION_BUSINESS_TYPE_LOOKUP_TOKEN,
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
 * Orchestriert Schritt 1 (Anmeldedaten erfassen) und Schritt 2 (OTP-Verifikation)
 * des mehrstufigen Registrierungsflows.
 *
 * Wichtige Invarianten:
 *  - `start()` liefert IMMER eine neutrale Antwort (Account-Enumeration-Schutz).
 *  - OTP wird nur als SHA-256-Hash gespeichert, niemals im Klartext.
 *  - Passwoerter werden vom injizierten PasswordHasher (i. d. R. Argon2) gehashed.
 *  - Bei Rate-Limit-Treffer wird der OTP-Send still verworfen — keine 429-Antwort,
 *    sonst koennte ein Angreifer die Existenz eines PendingRegistration-Datensatzes
 *    aus dem Statuscode ableiten.
 *  - OTP-Fehlversuche werden persistent gezaehlt: ab `OTP_VERIFY_MAX_ATTEMPTS`
 *    wirft `verifyOtp()` `OTP_LOCKED` — auch bei danach korrektem Code. Erst
 *    ein neu generierter OTP (Resend, separat ratelimitiert) entsperrt.
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
        @Optional()
        @Inject(REGISTRATION_BUSINESS_TYPE_LOOKUP_TOKEN)
        private readonly businessTypeLookup?: RegistrationBusinessTypeLookup,
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
            // Audit-Versagen darf den Auth-Flow nicht abbrechen.
            const message = error instanceof Error ? error.message : String(error);
            this.logger.warn(`Audit-Log fehlgeschlagen (${eventType}): ${message}`);
        }
    }

    /** Public-Signup-Plan-Liste fuer Step 3 (Frontend `usePublicPlans()`). */
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
        // Plan kann nur nach Email-Verifikation und vor erfolgter Aktivierung
        // gewaehlt werden. Plan-Wechsel im Status PLAN_SELECTED / CHECKOUT_STARTED
        // ist erlaubt — Spec laesst Wechsel bis Zahlung zu.
        if (
            pending.status !== 'EMAIL_VERIFIED' &&
            pending.status !== 'PLAN_SELECTED' &&
            pending.status !== 'CHECKOUT_STARTED'
        ) {
            throw new BadRequestException({ code: 'INVALID_REGISTRATION_STATE' });
        }

        const plan = await this.planCatalog.findPublicSignupPlan(input.planId);
        if (!plan) {
            // Plan existiert nicht im Catalog ODER ist nicht public-signup-faehig
            // (z. B. ENTERPRISE). Beide Faelle liefern dieselbe Antwort, damit
            // Plan-Existenz nicht ueber unterschiedliche Fehlercodes leaked.
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
        // Sicherheits-Re-Check: Plan koennte zwischen Step 3 und Step 4 aus
        // dem Catalog rausgenommen worden sein (z. B. Wartungsfenster).
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
     * Verarbeitet einen Payment-Webhook idempotent:
     *  1. `tryClaim` haelt den Event-ID per @unique-INSERT fest. Duplikate
     *     werden silently gedropped (`ALREADY_PROCESSED`).
     *  2. Bei Status `SUCCEEDED` wird die PendingRegistration aus der
     *     Checkout-Session aufgeloest und der ActivationOrchestrator ruft
     *     die finale User+Tenant+Subscription-Erzeugung in einer Transaktion.
     *  3. Nach Aktivierung wird die PendingRegistration geloescht.
     *
     * Bei Fehlern in Schritt 2/3 bleibt der EventLog-Eintrag bestehen —
     * Re-Tries vom Provider laufen dann ins ALREADY_PROCESSED. Operative
     * Reparatur passiert manuell (Status-Inspektion + Cleanup).
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
        // PLAN_SELECTED zulassen: falls der Webhook *vor* dem startCheckout-
        // Update-Roundtrip ankommt (race), waere status noch PLAN_SELECTED.
        // CHECKOUT_STARTED ist der Standardfall.
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
     * Loescht alle PendingRegistration-Datensaetze mit `expiresAt < now`.
     * Vollstaendige Loeschung (kein Anonymisierung-Pfad) ist die einfachere
     * Variante: das Schema haelt `email`, `firstName`, `lastName`,
     * `passwordHash` als NOT NULL, und unique-Email ist genau das, was nach
     * Ablauf wieder frei werden muss.
     *
     * Batch-`limit` schuetzt vor Memory-Spikes bei grossen Backlogs — der
     * Caller (Cron) ruft solange auf, bis `moreAvailable === false`.
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
                // Loeschfehler nicht eskalieren — z. B. konkurrierender Cleanup
                // hat den Datensatz schon entfernt. Loggen und weiter.
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
            // Fall A: Aktiver Account existiert. Keine PendingRegistration anlegen,
            // keine Information nach aussen geben. Optional koennte hier ein
            // Passwort-Reset-Link gesendet werden (Phase 2+).
            this.logger.log(`register/start fuer aktiven Account ignoriert (${email}).`);
            await this.record('REGISTRATION_NEUTRAL_ACTIVE_USER', null, context);
            return { neutral: true };
        }

        const existing = await this.repo.findByEmail(email);
        if (existing) {
            if (existing.expiresAt.getTime() < Date.now()) {
                // Fall E: Abgelaufen. Loeschen und unten frisch anlegen.
                await this.repo.delete(existing.id);
                await this.record('REGISTRATION_NEUTRAL_EXPIRED', existing.id, context);
            } else if (existing.status === 'PENDING_EMAIL_VERIFICATION') {
                // Fall B: Es laeuft eine unbestaetigte Registrierung. Neuer OTP,
                // alter wird invalidiert. Andere Felder bleiben unveraendert
                // (kein Override durch potentiellen Angreifer).
                await this.regenerateOtp(existing);
                await this.record('REGISTRATION_NEUTRAL_REPLAY', existing.id, context, {
                    status: existing.status,
                });
                return { neutral: true };
            } else {
                // Fall C/D: Onboarding ist schon weiter (EMAIL_VERIFIED,
                // PLAN_SELECTED, CHECKOUT_STARTED). Spec § Fall C/D: Wir
                // senden einen *Resume-Link* mit signiertem Token, kein
                // neuer OTP — der User soll nicht nochmal verifizieren.
                // Fallback (kein Signer konfiguriert): regenerateOtp wie Fall B.
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
            // Bereits verifiziert: idempotente Antwort mit aktuellem Step.
            // (Verhindert Fehler, wenn das Frontend einen Verify-Call doppelt sendet.)
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
        // Brute-Force-Lockout als claim-then-check: erst atomar einen
        // Versuchs-Slot beanspruchen, DANN vergleichen — so ist die Zahl der
        // Hash-Vergleiche pro Code auch bei parallelen Requests hart
        // gedeckelt. Der Vorab-Check auf dem gelesenen Stand ist nur die
        // Abkuerzung, die bereits gesperrten Codes den Inkrement erspart.
        const maxAttempts = resolveOtpVerifyMaxAttempts();
        if (pending.otpAttemptCount >= maxAttempts) {
            await this.record('OTP_VERIFY_FAILED', pending.id, context, { reason: 'locked' });
            throw new BadRequestException({ code: 'OTP_LOCKED' });
        }
        // `neuerStand > Limit` bedeutet: der Zaehler war schon VOR diesem
        // Versuch am Limit — ein paralleler Request hat das Budget bereits
        // aufgebraucht; dieser Request bekommt keinen Hash-Vergleich mehr.
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
        // Account-Enumeration-Schutz: ob es einen Datensatz gibt oder nicht — gleiche Antwort.
        if (!pending) {
            return { neutral: true };
        }
        if (pending.status !== 'PENDING_EMAIL_VERIFICATION') {
            // Wenn er schon weiter ist, schicken wir der UX zuliebe trotzdem einen neuen OTP
            // (z. B. wenn der User auf "Neuen Code senden" klickt und dann nochmal
            // doppelt sendet). Andere Status sind kein Fehler, aber kein OTP-Versand.
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
            // Neuer Code = frisches Versuchsbudget. Der Gesamtdurchsatz bleibt
            // durch das Send-Rate-Limit oben gedeckelt.
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
            // Mail-Versand-Fehler darf den Flow nicht spuerbar abbrechen
            // (sonst Account-Enumeration ueber Timing/Statuscode). Nur loggen.
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`OTP-Mail an ${pending.email} fehlgeschlagen: ${message}`);
        }
    }

    /**
     * Erzeugt einen signierten Resume-Token (60 min TTL) und sendet einen
     * Magic-Link an die hinterlegte Email. Mail-Versand-Fehler werden
     * geloggt aber nicht eskaliert (Account-Enumeration-Schutz).
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
     * Loest einen Resume-Token in den passenden Onboarding-Schritt auf.
     * Wird vom Frontend aus `/register?resume=<jwt>` aufgerufen. Bei ungueltigem
     * Token wirft die Methode `RESUME_TOKEN_INVALID`.
     *
     * Liefert einen Public-Safe-Snapshot der PendingRegistration mit, damit
     * das Frontend abgeschlossene Steps mit den existierenden Daten befuellen
     * kann (Vorname/Nachname, Vereinsname, Plan-Auswahl ...).
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
     * Signiert ein kurzlebiges Resume-Token fuer eine bestehende
     * PendingRegistration — Login-Endpoint nutzt das, um nach erfolgreicher
     * Passwort-Verifikation den User mit Pre-Fill in den Wizard zu schicken.
     */
    async signResumeToken(pendingRegistrationId: string): Promise<string | null> {
        if (!this.resumeTokenSigner) return null;
        return this.resumeTokenSigner.sign({ pendingRegistrationId });
    }

    /* ─── Konfigurator (Step 3) ────────────────────────────────────────── */

    /** Liefert den (App-spezifischen) Konfigurator-Catalog. */
    async getConfiguratorCatalog(): Promise<ConfiguratorCatalog> {
        if (!this.configuratorLookup) {
            throw new BadRequestException({ code: 'CONFIGURATOR_NOT_CONFIGURED' });
        }
        return this.configuratorLookup.getCatalog();
    }

    /**
     * Speichert die Konfigurator-Auswahl (Modell + Cycle + Promo) und
     * liefert den vollstaendigen Preis-Breakdown zurueck.
     *
     * Setzt:
     *  - `status = PLAN_SELECTED`
     *  - `currentStep = 4`
     *  - `selectedPlanId = <PlanId aus dem gewaehlten Modell>`
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

        // SPEC_V2 §11.1 M5.3 — optionale BusinessType-Wahl gegen den
        // Lookup-Adapter validieren. Nur prüfen, wenn beides gesetzt ist:
        // ID in der Selection UND Lookup im DI-Graph (Apps ohne
        // BusinessType-Katalog konfigurieren keinen Lookup, dann
        // wird die ID ignoriert).
        if (input.selection.businessTypeVersionId && this.businessTypeLookup) {
            const view = await this.businessTypeLookup.findPublishedVersion(
                input.selection.businessTypeVersionId,
            );
            if (!view) {
                throw new BadRequestException({ code: 'BUSINESS_TYPE_NOT_AVAILABLE' });
            }
        }

        // Promo-Code optional: bei Vorhandensein gegen den Preview-Adapter laufen lassen.
        let promoEval: { discountAmount: number; percent: number; label: string } | undefined;
        if (input.selection.appliedPromoCode && this.promoPreview) {
            // Zuerst ohne Promo rechnen, um Brutto-Subtotal zu bekommen.
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
     * Validiert einen Promo-Code gegen die aktuell gespeicherte
     * Konfiguration und liefert einen neuen Breakdown zurueck. Verandert
     * die Pending NICHT — fuer Live-Preview im Frontend. Wird `null` als
     * `code` uebergeben, wird der Promo-Effekt entfernt.
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
     * Helper fuer Step-3-Resume: Frontend braucht den aktuellen Breakdown,
     * wenn die Pending schon eine Konfiguration hat. Pure Re-Berechnung
     * gegen den Catalog (ohne Promo-Validation, weil Promos ohnehin frisch
     * geprueft werden sollten).
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
 * Max. OTP-Fehlversuche: Plattform-Default aus den Registration-Konstanten,
 * per Env `SAAS_PLATFORM_OTP_VERIFY_MAX_ATTEMPTS` uebersteuerbar. Wird pro
 * Aufruf gelesen (analog `SAAS_PLATFORM_SKIP_RATE_LIMITS` im IP-Guard),
 * damit Konsumenten/Tests ohne Neustart umkonfigurieren koennen.
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
