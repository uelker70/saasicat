// RegistrationModule — DI-Wrapper um PendingRegistrationService.
//
// Konsumenten reichen ihre fuenf Adapter-Implementierungen
// (PendingRegistrationRepository, RegistrationOtpDelivery, UserAccountLookup,
// SlugAvailabilityCheck, PasswordHasher) durch `forRoot({...})`.

import {
    type DynamicModule,
    type ForwardReference,
    Module,
    type Provider,
    type Type,
} from '@nestjs/common';
import type {
    ActivationOrchestrator,
    PaymentEventLog,
    PaymentProvider,
    PendingRegistrationRepository,
    PlanCatalogLookup,
    RegistrationAuditLogger,
    RegistrationBusinessTypeLookup,
    RegistrationConfiguratorLookup,
    RegistrationOtpDelivery,
    RegistrationPromoPreview,
    RegistrationResumeDelivery,
    RegistrationResumeTokenSigner,
    SlugAvailabilityCheck,
    UserAccountLookup,
} from '@saasicat/types';
import { PendingRegistrationService } from './pending-registration.service.js';
import { RegistrationCleanupCron } from './cleanup.cron.js';
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
import { asProvider, type ProviderSpec } from '../core/di.js';

export interface RegistrationModuleOptions {
    pendingRegistrationRepository: ProviderSpec<PendingRegistrationRepository>;
    otpDelivery: ProviderSpec<RegistrationOtpDelivery>;
    userAccountLookup: ProviderSpec<UserAccountLookup>;
    slugAvailabilityCheck: ProviderSpec<SlugAvailabilityCheck>;
    passwordHasher: ProviderSpec<PasswordHasher>;
    planCatalogLookup: ProviderSpec<PlanCatalogLookup>;
    paymentProvider: ProviderSpec<PaymentProvider>;
    paymentEventLog: ProviderSpec<PaymentEventLog>;
    activationOrchestrator: ProviderSpec<ActivationOrchestrator>;
    auditLogger: ProviderSpec<RegistrationAuditLogger>;
    /**
     * P3.4 (optional): Signiert + verifiziert Resume-Tokens fuer Faelle C/D
     * (EMAIL_VERIFIED / PLAN_SELECTED / CHECKOUT_STARTED). Wird der Port
     * nicht uebergeben, faellt der Service auf OTP-Resend fuer alle Stati
     * zurueck.
     */
    resumeTokenSigner?: ProviderSpec<RegistrationResumeTokenSigner>;
    /** P3.4 (optional): Versendet die Resume-Mail mit Magic-Link. */
    resumeDelivery?: ProviderSpec<RegistrationResumeDelivery>;
    /** P3.4 (optional): Base-URL der App fuer den Resume-Link (z. B. `https://app.example.com`). */
    resumeBaseUrl?: string;
    /**
     * Phase A: Liefert den App-spezifischen Konfigurator-Catalog. Ohne
     * diesen Port wirft `saveConfiguration()` `CONFIGURATOR_NOT_CONFIGURED`.
     */
    configuratorLookup?: ProviderSpec<RegistrationConfiguratorLookup>;
    /**
     * Phase A: Promo-Code-Preview-Adapter (wrapt typisch
     * `PromoCodesService.preview()`). Ohne Adapter wird der Promo-Code
     * ignoriert (Snapshot wird gespeichert, Discount=0).
     */
    promoPreview?: ProviderSpec<RegistrationPromoPreview>;
    /**
     * SPEC_V2 §11.1 M5.3: validiert eine optional gesetzte
     * `RegistrationConfigSelection.businessTypeVersionId` gegen den
     * SuperAdmin-Catalog (published BusinessTypeVersions). Ohne Adapter
     * wird die ID ungeprüft durchgereicht — passt für Apps ohne
     * BusinessType-Katalog (z. B. AutohausPro).
     */
    businessTypeLookup?: ProviderSpec<RegistrationBusinessTypeLookup>;
    /**
     * Module, die im DynamicModule-Scope sichtbar sein sollen — nötig, damit
     * Factory-Provider mit `inject: [...]` Klassen aus diesen Modulen
     * auflösen können. Analog zu AdminStatsModule.
     */
    imports?: Array<Type<unknown> | DynamicModule | ForwardReference | Promise<DynamicModule>>;
    /**
     * Zusätzliche Provider, die direkt im DynamicModule-Scope registriert
     * werden. Üblicherweise die App-Adapter (Prisma-Repos, Email-Service-
     * Wrapper, Argon2-Hasher), damit ihre `inject: [...]`-Tokens auflösbar
     * sind (sonst UnknownDependenciesException bei strikten NestJS-Versionen).
     */
    extraProviders?: Provider[];
    /**
     * Default `true`. Registriert `RegistrationCleanupCron` (taeglich 04:15
     * Europe/Berlin). Auf `false` setzen, wenn der Konsument keinen
     * `@nestjs/schedule` aktiv hat (z. B. CLI-Boot, Unit-Tests).
     */
    includeCleanupCron?: boolean;
    /** Modul global registrieren — Default `false`. */
    global?: boolean;
}

@Module({})
export class RegistrationModule {
    static forRoot(options: RegistrationModuleOptions): DynamicModule {
        const providers: Provider[] = [
            ...(options.extraProviders ?? []),
            asProvider(
                PENDING_REGISTRATION_REPOSITORY_TOKEN,
                options.pendingRegistrationRepository,
            ),
            asProvider(REGISTRATION_OTP_DELIVERY_TOKEN, options.otpDelivery),
            asProvider(USER_ACCOUNT_LOOKUP_TOKEN, options.userAccountLookup),
            asProvider(SLUG_AVAILABILITY_CHECK_TOKEN, options.slugAvailabilityCheck),
            asProvider(PASSWORD_HASHER_TOKEN, options.passwordHasher),
            asProvider(PLAN_CATALOG_LOOKUP_TOKEN, options.planCatalogLookup),
            asProvider(PAYMENT_PROVIDER_TOKEN, options.paymentProvider),
            asProvider(PAYMENT_EVENT_LOG_TOKEN, options.paymentEventLog),
            asProvider(ACTIVATION_ORCHESTRATOR_TOKEN, options.activationOrchestrator),
            asProvider(REGISTRATION_AUDIT_LOGGER_TOKEN, options.auditLogger),
            PendingRegistrationService,
        ];
        if (options.resumeTokenSigner) {
            providers.push(
                asProvider(REGISTRATION_RESUME_TOKEN_SIGNER_TOKEN, options.resumeTokenSigner),
            );
        }
        if (options.resumeDelivery) {
            providers.push(asProvider(REGISTRATION_RESUME_DELIVERY_TOKEN, options.resumeDelivery));
        }
        if (options.resumeBaseUrl !== undefined) {
            providers.push({
                provide: REGISTRATION_RESUME_BASE_URL_TOKEN,
                useValue: options.resumeBaseUrl,
            });
        }
        if (options.configuratorLookup) {
            providers.push(
                asProvider(REGISTRATION_CONFIGURATOR_LOOKUP_TOKEN, options.configuratorLookup),
            );
        }
        if (options.promoPreview) {
            providers.push(asProvider(REGISTRATION_PROMO_PREVIEW_TOKEN, options.promoPreview));
        }
        if (options.businessTypeLookup) {
            providers.push(
                asProvider(REGISTRATION_BUSINESS_TYPE_LOOKUP_TOKEN, options.businessTypeLookup),
            );
        }
        const includeCleanupCron = options.includeCleanupCron ?? true;
        if (includeCleanupCron) {
            providers.push(RegistrationCleanupCron);
        }

        return {
            module: RegistrationModule,
            global: options.global ?? false,
            imports: options.imports ?? [],
            providers,
            exports: includeCleanupCron
                ? [PendingRegistrationService, RegistrationCleanupCron]
                : [PendingRegistrationService],
        };
    }
}
