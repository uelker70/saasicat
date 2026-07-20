// Registration / PendingRegistration — Mehrstufiger Registrierungs- und
// Onboarding-Flow.
//
// Eine PendingRegistration haelt den Zwischenzustand zwischen Schritt 1
// (Anmeldedaten erfassen) und der finalen Aktivierung (Schritt 4: Zahlung).
// Erst nach erfolgreicher Zahlung wird daraus User + Tenant + Subscription.
// Bis dahin bleibt der Datensatz losgeloest vom produktiven User-Modell.

export const PENDING_EMAIL_TTL_HOURS = 72;
export const PENDING_ONBOARDING_TTL_DAYS = 14;
export const PENDING_CHECKOUT_TTL_DAYS = 30;
export const OTP_TTL_MINUTES = 10;
export const PASSWORD_RESET_TTL_MINUTES = 30;

/** Anzahl OTP-Sends pro Rolling-Window, bevor weitere Sends still verschluckt werden. */
export const OTP_RATE_LIMIT_MAX_SENDS = 3;
export const OTP_RATE_LIMIT_WINDOW_MINUTES = 15;

/**
 * Max. Verifikationsversuche pro OTP-Code (jeder Versuch beansprucht vor dem
 * Hash-Vergleich atomar einen Slot). Ab Erreichen wirft `verifyOtp()`
 * `OTP_LOCKED` — auch bei danach korrektem Code. Ein neu generierter OTP
 * setzt den Zaehler zurueck (Versand bleibt separat ratelimitiert).
 * Env-Override: `SAAS_PLATFORM_OTP_VERIFY_MAX_ATTEMPTS`.
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

/** Mapping Status -> Step, dass das Frontend nach Login/Resume verwendet. */
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
    /** Persistenter Zaehler der OTP-Verifikationsversuche (Brute-Force-Lockout). */
    otpAttemptCount: number;

    selectedPlanId: string | null;

    /** Konfigurator-Auswahl-Snapshot (Step 3). Wird vom Service gesetzt. */
    configJson: RegistrationConfigSelection | null;
    /** Wird beim ersten `saveConfiguration()`-Call gesetzt. */
    billingCycle: 'MONTHLY' | 'YEARLY' | null;
    /** Klartext-Code (UI-Anzeige). Validierung laeuft jedes Mal frisch. */
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

/** Adapter-Port: Persistenz fuer PendingRegistration (CRUD). */
export interface PendingRegistrationRepository {
    findById(id: string): Promise<PendingRegistration | null>;
    findByEmail(email: string): Promise<PendingRegistration | null>;
    /** Webhook-Lookup: findet die Pending zur Provider-Session. */
    findByCheckoutSession(sessionId: string): Promise<PendingRegistration | null>;
    /**
     * Cleanup-Lookup: alle Pending-Datensaetze mit `expiresAt < now`, max
     * `limit` Eintraege pro Aufruf (Batch-Schutz). Sortierung egal, der
     * Cron-Service iteriert sequenziell.
     */
    findExpired(now: Date, limit: number): Promise<PendingRegistration[]>;
    create(input: PendingRegistrationCreateInput): Promise<PendingRegistration>;
    update(id: string, input: PendingRegistrationUpdateInput): Promise<PendingRegistration>;
    /**
     * Erhoeht `otpAttemptCount` atomar um 1 und liefert den NEUEN Stand.
     * Muss DB-seitig atomar sein (z. B. Prisma `{ increment: 1 }`), damit
     * parallele Fehlversuche sich nicht gegenseitig ueberschreiben — der
     * Rueckgabewert ist die massgebliche Schranke fuer den Lockout-Check.
     */
    incrementOtpAttemptCount(id: string): Promise<number>;
    delete(id: string): Promise<void>;
}

/** Adapter-Port: Erkennt, ob ein voller User-Account (verifiziert) mit dieser Mail existiert. */
export interface UserAccountLookup {
    hasActiveUser(email: string): Promise<boolean>;
}

/** Adapter-Port: Pruefen, ob ein Slug fuer einen neuen Tenant frei ist. */
export interface SlugAvailabilityCheck {
    isSlugAvailable(slug: string): Promise<boolean>;
}

/** Wire-Format einer erzeugten Checkout-Session (Provider-agnostisch). */
export interface CheckoutSession {
    /** Provider-spezifische Session-ID (z. B. Stripe `cs_…`). */
    sessionId: string;
    /** Vom Frontend zu oeffnende Bezahl-URL. */
    checkoutUrl: string;
    /** Optional: Provider-Name (`stripe`, `dev-stub`) fuer Logging/Audit. */
    provider?: string;
}

export type PaymentEventStatus = 'SUCCEEDED' | 'FAILED';

/**
 * Adapter-Port: Idempotenz-Log fuer Payment-Webhooks. Stripe (und die meisten
 * anderen Provider) liefern Events at-least-once — der Service ruft
 * `tryClaim` als atomaren Race-Schutz auf, BEVOR er die finale Aktivierung
 * triggert.
 */
export interface PaymentEventLog {
    /**
     * Versucht, einen Event-Datensatz mit `@unique` INSERT zu setzen. Liefert
     * `true`, wenn er neu angelegt wurde (Webhook ist zum ersten Mal gesehen),
     * `false`, wenn er bereits existiert (Duplikat → silently drop).
     *
     * Implementierungen muessen einen DB-Unique-Constraint-Violation-Fehler
     * (Prisma P2002) als `false` zurueckliefern.
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
 * Adapter-Port: orchestriert die finale Erzeugung von User + Tenant +
 * Subscription nach erfolgreicher Zahlung. App-spezifisch — jede App hat ihr
 * eigenes Schema (z. B. Tenant + TenantUser + Role + UserRole +
 * Subscription).
 *
 * Implementierungen MUESSEN die Erzeugung in einer DB-Transaktion ausfuehren,
 * damit Teil-Erzeugungen bei Fehlern vollstaendig zurueckgerollt werden.
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
    /** Anzahl der geloeschten PendingRegistration-Datensaetze. */
    deleted: number;
    /**
     * `true`, wenn das Batch-Limit erreicht wurde — der naechste Cron-Lauf
     * uebernimmt den Rest. Verhindert Memory-Spikes bei grossen Backlogs.
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
 * Kontext-Informationen, die das Audit-Layer pro Event mitschreibt.
 * IP wird als gehashter Fingerprint erwartet — keine Klartext-IPs im
 * Audit-Log (DSGVO/Compliance), kein Email-Klartext (Account-Enumeration).
 */
export interface RegistrationAuditContext {
    ipHash?: string | null;
    userAgent?: string | null;
}

export interface RegistrationAuditEvent {
    eventType: RegistrationAuditEventType;
    /**
     * Pending-Registration-ID, falls schon bekannt. Bei neutralen Antworten
     * (z. B. `start` ohne neue Pending) `null`.
     */
    pendingRegistrationId: string | null;
    context?: RegistrationAuditContext;
    /**
     * Freies Metadata-Feld. NIEMALS Email/Passwort/OTP im Klartext rein —
     * Implementierungen muessen das selbst durchsetzen.
     */
    metadata?: Record<string, unknown>;
}

/**
 * Adapter-Port: persistiert Audit-Events fuer den Registrierungs-Flow.
 * Implementierungen typisch gegen die jeweilige `AuditLog`-Tabelle der App.
 *
 * Log-Versagen darf den Auth-Flow nicht abbrechen — Implementierungen sollen
 * Fehler intern fangen und nur loggen, nicht werfen.
 */
export interface RegistrationAuditLogger {
    log(event: RegistrationAuditEvent): Promise<void>;
}

/* ─── Konfigurator-Datenmodell (Onboarding-Step 3) ──────────────────────── */

export interface ConfiguratorModel {
    id: string;
    code: string;
    name: string;
    glyph: string;
    tagline: string;
    /** Mapping auf den PlanCatalog (STARTER/STANDARD/PROFESSIONAL). */
    planId: string;
    monthlyNet: number;
    yearlyNet: number;
    tags: string[];
    /** Feature-Keys, die im Modell-Preis enthalten sind (PlanVersion.features). */
    includedFeatureKeys: string[];
    quotaBase: Record<string, number>;
    popular?: boolean;
}

/**
 * SPEC_V2 §11.1 M5.3 — wählbare BusinessTypeVersion im Konfigurator.
 * Eine Auswahl-Karte pro published BusinessTypeVersion des App-Projekts.
 * `businessTypeVersionId` wandert in `RegistrationConfigSelection` und
 * von dort beim Activate in `Subscription.businessTypeVersionId`.
 *
 * Optional vom App-Adapter befüllt — Apps ohne BusinessType-Katalog
 * lassen das Feld leer/undefined, der UI-Step bleibt
 * dann ausgeblendet.
 */
export interface ConfiguratorBusinessType {
    businessTypeVersionId: string;
    businessTypeKey: string;
    label: string;
    description?: string | null;
    /** Ausgewählte Bundle-Keys (Übersicht für UI), in Sortierreihenfolge. */
    bundleKeys: string[];
    /** App-spezifische Sortierreihenfolge; aufsteigend (kleiner = oben). */
    sortOrder: number;
}

export interface ConfiguratorCatalog {
    /** Faktor `yearlyNet = monthlyNet * cycleDiscount` (typisch 10 = 2 Monate gratis). */
    cycleDiscount: number;
    currency: string;
    vatRate: number;
    models: ConfiguratorModel[];
    /**
     * SPEC_V2 §11.1 M5.3 — published BusinessTypeVersions als optionale
     * Vorauswahl. Apps ohne BusinessType-Katalog lassen das Feld weg
     * oder geben `[]` zurück.
     */
    businessTypes?: ConfiguratorBusinessType[];
}

export interface RegistrationConfigSelection {
    modelId: string;
    billingCycle: 'MONTHLY' | 'YEARLY';
    appliedPromoCode: string | null;
    /**
     * SPEC_V2 §11.1 M5: optionale BusinessTypeVersion-Wahl. Additiv zur
     * Plan/Bundle-Auswahl — die Aggregation (§6) summiert Limits und vereinigt
     * Features. Wenn `null`, läuft die Aktivierung wie vor M5.3 (reiner
     * Plan-Pfad). Die ID wird vom Service gegen `RegistrationBusinessTypeLookup`
     * validiert (published BusinessTypeVersions im selben projectKey).
     */
    businessTypeVersionId?: string | null;
    /**
     * P11.4 (METAMODELL §17a): vorgewählter CheckoutOffer aus der Webseite
     * (`?offer=<id>`-Parameter). Wandert in `PendingRegistration.configJson`,
     * wird vom `ActivationOrchestrator` ausgelesen, um den Offer beim
     * Onboarding-Aktivieren zu konsumieren (`status=consumed`) und in
     * `Subscription.packageSnapshot` einzufrieren. Wenn `null`, läuft die
     * Aktivierung ohne Offer-Snapshot.
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
 * Adapter-Port: liefert den (App-spezifischen) Konfigurator-Catalog.
 *
 * Empfohlene Implementierung: `ConfiguratorCatalogBuilder` aus
 * `saas-platform-nest/billing`. Der Builder kombiniert SuperAdmin-DB-Daten
 * (live PlanVersions) mit einer App-lokalen Plan-Marketing-Map.
 */
export interface RegistrationConfiguratorLookup {
    getCatalog(): Promise<ConfiguratorCatalog>;
}

/**
 * SPEC_V2 §11.1 M5.3 — schmaler Adapter-Port, mit dem der
 * `PendingRegistrationService` eine vom Tenant gewählte
 * `businessTypeVersionId` validiert (Existenz, projectKey-Match,
 * Live-Status). Implementierung in der App (Prisma-Adapter über
 * `BusinessTypeRepository.listVersions` mit `publishedAt != null`).
 *
 * Die Validation ist „weich": ist kein Lookup konfiguriert, wird die
 * Selection ungeprüft durchgereicht — so bleiben Apps ohne
 * BusinessType-Katalog ohne Setup-Zwang.
 */
export interface RegistrationBusinessTypeLookup {
    /** Nur **published** Versions liefern; `null` wenn unbekannt/draft/superseded. */
    findPublishedVersion(
        businessTypeVersionId: string,
    ): Promise<RegistrationBusinessTypeVersionView | null>;
}

export interface RegistrationBusinessTypeVersionView {
    businessTypeVersionId: string;
    businessTypeId: string;
    businessTypeKey: string;
    label: string;
    version: number;
    /**
     * Informativ: zu welchem Projekt die Version gehört. Den Scope-Filter
     * `projectKey === <App-Projekt>` setzt der Adapter selbst — Apps geben
     * in `findPublishedVersion` immer nur Versions ihres eigenen projectKey
     * zurück.
     */
    projectKey: string;
}

/**
 * Wire-Format einer live-PlanVersion (latest published per planId).
 * Liest sich aus der DB-Tabelle `plan_versions`.
 */
export interface ConfiguratorPlanVersionRow {
    planId: string;
    version: number;
    monthlyNet: number;
    yearlyNet: number;
    /** Feature-Keys, die im Plan-Preis enthalten sind. */
    features: string[];
    /** Quota-Schluessel → Basis-Wert (`-1` = unbegrenzt). */
    quotas: Record<string, number>;
    marketed: boolean;
}

/**
 * Adapter-Port: liest die Konfigurator-Quellen aus der DB (SuperAdmin
 * pflegt sie). Konsumenten nutzen typischerweise eine Prisma-Implementierung.
 */
export interface ConfiguratorSourcesLookup {
    listLivePlans(): Promise<ConfiguratorPlanVersionRow[]>;
}

/**
 * App-lokale Marketing-Daten fuer den Plan-Auswahl-Bereich des Konfigurators.
 * Der SuperAdmin speichert nur PlanId/Preise — die "Modell"-Praesentation
 * (Vereinsname, Glyph, Tagline) ist branding und lebt in der App.
 */
export interface ConfiguratorPlanMarketing {
    /** PlanId aus dem SuperAdmin (z. B. `STARTER`). */
    planId: string;
    code: string;
    name: string;
    glyph: string;
    tagline: string;
    tags: string[];
    popular?: boolean;
}

/**
 * Adapter-Port: liefert die App-spezifischen Marketing-Daten (Plan-Names,
 * Preis-Parameter). Wird typischerweise von einer statischen TS-Konstante
 * in der App bereitgestellt.
 */
export interface ConfiguratorMarketingProvider {
    listPlanMarketing(): ConfiguratorPlanMarketing[];
    /** Faktor `yearlyNet = monthlyNet * cycleDiscount`. Default `10`. */
    getCycleDiscount(): number;
    getVatRate(): number;
    getCurrency(): string;
}

/**
 * Adapter-Port: Promo-Code-Preview gegen einen Brutto-Subtotal.
 * Wrapt typischerweise `saas-platform-nest/promo:PromoCodesService.preview()`.
 */
export interface RegistrationPromoPreview {
    preview(params: {
        code: string;
        planId: string;
        billingCycle: 'MONTHLY' | 'YEARLY';
        subtotalGross: number;
        /** Optional fuer firstTimeCustomersOnly-Pruefung. */
        email?: string;
    }): Promise<{
        valid: boolean;
        reason?: string;
        percent?: number;
        label?: string;
        discountAmount?: number;
    }>;
}

/** Default-TTL fuer signierte Resume-Tokens (60 min). */
export const REGISTRATION_RESUME_TTL_MINUTES = 60;

/**
 * Adapter-Port: signiert / verifiziert Resume-Tokens fuer den
 * "Registrierung fortsetzen"-Flow (Faelle C/D nach Spec).
 *
 * Token-Payload ist Provider-Detail (typisch JWT) — der Service kennt nur
 * `pendingRegistrationId` als Inhalt und `ttlMinutes` als Schliessfrist.
 */
export interface RegistrationResumeTokenSigner {
    sign(params: { pendingRegistrationId: string; ttlMinutes?: number }): Promise<string>;
    /**
     * Verifiziert das Token. Wirft, wenn Signatur oder Ablauf nicht passen
     * — die Service-Schicht uebersetzt das in eine BadRequestException mit
     * Code `RESUME_TOKEN_INVALID`.
     */
    verify(token: string): Promise<{ pendingRegistrationId: string }>;
}

/** Adapter-Port: Versand der Resume-Link-Mail an den User. */
export interface RegistrationResumeDelivery {
    sendResumeEmail(params: {
        to: string;
        firstName: string;
        locale: string;
        resumeUrl: string;
    }): Promise<void>;
}

/**
 * Eingabe an `PendingRegistrationService.resumeWithToken()` — das Frontend
 * uebergibt den Token aus der `?resume=<jwt>`-Query.
 */
export interface ResumeRegistrationInput {
    token: string;
    /**
     * Base-URL der App, gegen die der Resume-Link generiert wird
     * (z. B. `https://app.example.com`). Wird nur an die Mail-Delivery
     * weitergereicht, der Service selbst hostet keinen Link.
     */
    resumeBaseUrl?: string;
}

/**
 * Public-safe Snapshot einer PendingRegistration fuer den Resume-Flow:
 * Frontend befuellt die abgeschlossenen Onboarding-Steps mit diesen Daten.
 *
 * Bewusst OHNE `passwordHash`, `otpHash`, `otpExpiresAt` — diese duerfen
 * niemals an den Client.
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
    /** Konfigurator-Auswahl-Snapshot fuer Step-3-Resume. */
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

/** Adapter-Port: Payment-Provider (Stripe, Dev-Stub, Mollie, ...). */
export interface PaymentProvider {
    /**
     * Legt eine Checkout-Session beim Payment-Provider an und liefert die URL,
     * auf die das Frontend redirecten soll.
     *
     * @param params.pendingRegistrationId Wird als `client_reference_id` (o. AE.)
     *   im Provider gespeichert — der Webhook braucht ihn zur Rueckverknuepfung.
     * @param params.planId Der gewaehlte Plan (Stripe-Price/Product-Mapping liegt
     *   im Adapter).
     * @param params.successUrl Wohin nach erfolgreicher Zahlung.
     * @param params.cancelUrl Wohin bei Abbruch.
     */
    createCheckoutSession(params: {
        pendingRegistrationId: string;
        planId: string;
        email: string;
        successUrl: string;
        cancelUrl: string;
    }): Promise<CheckoutSession>;
}

/** Adapter-Port: OTP-Versand per E-Mail (oder anderem Kanal). */
export interface RegistrationOtpDelivery {
    sendVerificationOtp(params: {
        to: string;
        code: string;
        firstName: string;
        locale: string;
    }): Promise<void>;
}

/** Wire-Format fuer einen oeffentlich waehlbaren Plan im Onboarding-Step 3. */
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
 * Adapter-Port: liefert die Plan-Auswahl fuer Step 3 (Paketauswahl).
 *
 * Implementierung pruefe BEIDES:
 *  - Plan ist im Catalog vermarktbar (`marketed !== false`).
 *  - Es existiert eine publizierte, nicht-superseded `PlanVersion` in der DB
 *    (sonst kann die finale `Subscription` keinen `planVersionId` setzen).
 */
export interface PlanCatalogLookup {
    /** Liste aller Public-Signup-faehigen Plaene; leer, wenn keine. */
    listPublicSignupPlans(): Promise<PublicSignupPlan[]>;
    /** Detail-Lookup eines Plans. null, wenn nicht waehlbar (z. B. ENTERPRISE). */
    findPublicSignupPlan(planId: string): Promise<PublicSignupPlan | null>;
}

/** Eingabe an PendingRegistrationService.start(). */
export interface StartRegistrationInput {
    tenantName: string;
    /** Wenn null/undefined wird er aus tenantName generiert. */
    tenantSlug?: string | null;
    salutation?: string | null;
    firstName: string;
    lastName: string;
    email: string;
    password: string;
    locale?: string;
}

/** Ergebnis-Vertrag fuer den (account-enumeration-sicheren) Start-Call. */
export interface StartRegistrationResult {
    /** Immer true. Account-Enumeration-Schutz: keine Information ueber DB-Zustand nach aussen. */
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
