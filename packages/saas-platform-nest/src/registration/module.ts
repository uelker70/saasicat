// RegistrationModule — DI wrapper around PendingRegistrationService.
//
// Consumers pass their five adapter implementations
// (PendingRegistrationRepository, RegistrationOtpDelivery, UserAccountLookup,
// SlugAvailabilityCheck, PasswordHasher) through `forRoot({...})`.

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
     * P3.4 (optional): Signs + verifies resume tokens for cases C/D
     * (EMAIL_VERIFIED / PLAN_SELECTED / CHECKOUT_STARTED). If the port
     * is not provided, the service falls back to OTP resend for all
     * statuses.
     */
    resumeTokenSigner?: ProviderSpec<RegistrationResumeTokenSigner>;
    /** P3.4 (optional): Sends the resume mail with a magic link. */
    resumeDelivery?: ProviderSpec<RegistrationResumeDelivery>;
    /** P3.4 (optional): Base URL of the app for the resume link (e.g. `https://app.example.com`). */
    resumeBaseUrl?: string;
    /**
     * Phase A: Provides the app-specific configurator catalog. Without
     * this port, `saveConfiguration()` throws `CONFIGURATOR_NOT_CONFIGURED`.
     */
    configuratorLookup?: ProviderSpec<RegistrationConfiguratorLookup>;
    /**
     * Phase A: Promo-code preview adapter (typically wraps
     * `PromoCodesService.preview()`). Without the adapter the promo code
     * is ignored (snapshot is stored, discount=0).
     */
    promoPreview?: ProviderSpec<RegistrationPromoPreview>;
    /**
     * SPEC_V2 §11.1 M5.3: validates an optionally set
     * `RegistrationConfigSelection.businessTypeVersionId` against the
     * SuperAdmin catalog (published BusinessTypeVersions). Without an adapter
     * the ID is passed through unchecked — fine for apps without a
     * BusinessType catalog.
     */
    businessTypeLookup?: ProviderSpec<RegistrationBusinessTypeLookup>;
    /**
     * Modules that should be visible in the DynamicModule scope — needed so
     * that factory providers with `inject: [...]` can resolve classes from
     * these modules. Analogous to AdminStatsModule.
     */
    imports?: Array<Type<unknown> | DynamicModule | ForwardReference | Promise<DynamicModule>>;
    /**
     * Additional providers registered directly in the DynamicModule scope.
     * Usually the app adapters (Prisma repos, email-service wrapper,
     * Argon2 hasher), so that their `inject: [...]` tokens are resolvable
     * (otherwise UnknownDependenciesException on strict NestJS versions).
     */
    extraProviders?: Provider[];
    /**
     * Default `true`. Registers `RegistrationCleanupCron` (daily 04:15
     * Europe/Berlin). Set to `false` when the consumer has no active
     * `@nestjs/schedule` (e.g. CLI boot, unit tests).
     */
    includeCleanupCron?: boolean;
    /** Register module globally — default `false`. */
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
