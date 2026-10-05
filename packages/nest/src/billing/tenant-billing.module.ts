import {
    type CanActivate,
    type DynamicModule,
    type ForwardReference,
    Module,
    type Provider,
    type Type,
} from '@nestjs/common';
import { planCatalogSchema } from '@saasicat/spec';

import { asProvider, type ProviderSpec } from '../core/di.js';
import type {
    BundleRepository,
    BundleVersionRetirementRepository,
    PlanCatalogSettings,
    SubscriberLedgerRepository,
    SubscriberRepository,
    SubscriptionBundleRepository,
    SubscriptionContractRepository,
    SubscriptionNoticePort,
    SubscriptionNoticeRepository,
    SubscriptionUsagePort,
    TenantSubscriptionWritePort,
    TransactionRunner,
    UsageSnapshotPort,
    VersionRetirementRepository,
} from '@saasicat/core';
import { subscriberProviders } from '../subscriber/subscriber.module.js';
import { SubscriptionContractService } from '../subscription-contract/subscription-contract.service.js';
import {
    CONTRACT_TRANSACTION_RUNNER_TOKEN,
    SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN,
} from '../subscription-contract/subscription-contract.tokens.js';
import { ComposedTenantAuthGuard } from './composed-tenant-auth.guard.js';
import { TenantAdminGuard } from './tenant-admin.guard.js';
import { TenantBillingController } from './tenant-billing.controller.js';
import { PlanChangePreviewService } from './plan-change-preview.service.js';
import { VersionOfferService } from './version-offer.service.js';
import { VersionSwitchService } from './version-switch.service.js';
import { VersionNoticeCron } from './version-notice.cron.js';
import { RetirementMoveService } from './retirement-move.service.js';
import { RetirementReminderService } from './retirement-reminder.service.js';
import { RetirementSwitchService } from './retirement-switch.service.js';
import { BundleRetirementMoveService } from './bundle-retirement-move.service.js';
import { BundleRetirementSwitchService } from './bundle-retirement-switch.service.js';
import { BundleRetirementReminderService } from './bundle-retirement-reminder.service.js';
import { BundleVersionNoticeService } from './bundle-version-notice.service.js';
import { BundleVersionOfferService } from './bundle-version-offer.service.js';
import { BundleVersionSwitchRunService } from './bundle-version-switch-run.service.js';
import { BundleVersionSwitchService } from './bundle-version-switch.service.js';
import { BundleVersionRetirementService } from './bundle-version-retirement.service.js';
import type { AddOnsAhead } from './add-on-fits-plan.js';
import {
    BUNDLE_DELETION_CHECK_TOKEN,
    BUNDLE_REPOSITORY_TOKEN,
    PLAN_VERSION_ENDING_CHECK_TOKEN,
} from '../catalog/catalog.tokens.js';
import { PlansAheadService } from './plans-ahead.js';
import { VersionNoticeService } from './version-notice.service.js';
import {
    VersionRetirementService,
    retirementTermsConfirmed,
} from './version-retirement.service.js';
import { PLAN_CATALOG_SETTINGS_TOKEN } from './plan-catalog.module.js';
import { SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN } from './subscription-bundles.tokens.js';
import { PendingPlanMaterializationService } from './pending-plan-materialization.service.js';
import { SubscriberAccountService } from './charges/subscriber-account.service.js';
import { SubscriberChargeService } from './charges/subscriber-charge.service.js';
import { SUBSCRIBER_LEDGER_REPOSITORY_TOKEN } from './charges/subscriber-charge.tokens.js';
import { SubscriptionContractFreezeService } from './subscription-contract-freeze.service.js';
import { ContractRefreshService } from './contract-refresh.service.js';
import {
    CONTRACT_FREEZE_PORT_TOKEN,
    CONTRACT_FREEZE_SOURCE_PORT_TOKEN,
    type ContractFreezeSourcePort,
} from './contract-freeze.tokens.js';
import { SELF_SERVICE_BLOCKED_PLANS_TOKEN } from './self-service-policy.js';
import {
    AUDIT_CONTEXT_RESOLVER_TOKEN,
    BUNDLE_VERSION_RETIREMENT_REPOSITORY_TOKEN,
    PENDING_PLAN_QUERY_PORT_TOKEN,
    SUBSCRIPTION_NOTICE_PORT_TOKEN,
    SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN,
    SUBSCRIPTION_USAGE_PORT_TOKEN,
    SUBSCRIPTION_WRITE_PORT_TOKEN,
    TENANT_AUTH_GUARDS_TOKEN,
    TENANT_ID_RESOLVER_TOKEN,
    TRIAL_PROJECTION_PORT_TOKEN,
    USAGE_SNAPSHOT_PORT_TOKEN,
    USER_EMAIL_RESOLVER_TOKEN,
    USER_ID_RESOLVER_TOKEN,
    VERSION_RETIREMENT_REPOSITORY_TOKEN,
    VERSION_RETIREMENT_TRANSACTION_RUNNER_TOKEN,
    type AuditContextResolver,
    type PendingPlanQueryPort,
    type TenantIdResolver,
    type TrialProjectionPort,
    type UserEmailResolver,
    type UserIdResolver,
    ADD_ONS_AHEAD_TOKEN,
    CANCELLATION_NOTICE_DAYS_TOKEN,
    PLANS_AHEAD_TOKEN,
} from './tenant-billing.tokens.js';

/**
 * Checks at start-up that confirmed retirement terms can be acted on. A plain
 * symbol: created and read only here.
 */
const ORDERLY_RETIREMENT_IS_WIRED = Symbol('OrderlyRetirementIsWired');

// TenantBillingModule — registers the `TenantBillingController` with all
// tenant self-service endpoints (`/billing/entitlement`, `/billing/usage`,
// `/billing/plan/*`, `/billing/cancel`).
//
// Prerequisites:
//   - `PlanCatalogModule.forRoot({ path })` must already be loaded
//     (default `global: true` is sufficient).
//   - `EntitlementModule.forRoot({ ..., global: true })` must be loaded.
//     **Important**: `global: true` is required because
//     `PlanChangePreviewService` (registered internally in TenantBillingModule)
//     injects `EntitlementService` via constructor. Without global visibility
//     the app bootstrap breaks with UndefinedDependencyException.

/**
 * One commercial setting out of the catalogue, or a sentence saying where it
 * should have come from.
 *
 * The loader refuses a `config/saas.yaml` without `tenantBilling`, so a
 * catalogue arriving here without one was assembled in code — an object
 * handed straight to `planCatalog`; the database path reads the file too,
 * since `dbCatalog` names it. Without this the failure is
 * `Cannot read properties of undefined`, thrown from a Nest factory, which
 * names neither the file nor the field.
 */
function settingFromCatalog<K extends keyof PlanCatalogSettings['tenantBilling']>(
    catalog: PlanCatalogSettings,
    key: K,
): PlanCatalogSettings['tenantBilling'][K] {
    const settings = catalog.tenantBilling as PlanCatalogSettings['tenantBilling'] | undefined;
    const value = settings?.[key];
    if (value === undefined) {
        throw new Error(
            `The plan catalogue carries no tenantBilling.${key}. It is a required ` +
                'section of config/saas.yaml and the loader refuses a file without it, ' +
                'so a catalogue that reaches here without one was built in code: check ' +
                'the object passed to `planCatalog`.',
        );
    }
    return value;
}

/**
 * Everything `config/saas.yaml#tenantBilling` defines, read off the schema that
 * defines it.
 *
 * Not a list here. The day a third setting moves into that block, this refusal
 * covers it without anybody remembering to extend it — and a list beside the
 * schema is the same defect one level up: a second place the answer lives.
 */
const MOVED_TO_THE_FILE: readonly string[] = Object.keys(
    (
        planCatalogSchema as {
            properties?: { tenantBilling?: { properties?: Record<string, unknown> } };
        }
    ).properties?.tenantBilling?.properties ??
        // Refuses to guess rather than falling back to an empty list: an empty
        // one would turn this guard off without saying so.
        (() => {
            throw new Error(
                'plan-catalog.schema.json declares no tenantBilling properties — ' +
                    '@saasicat/spec and @saasicat/nest are out of step.',
            );
        })(),
);

/**
 * Refuses the boot when an app still passes a setting that moved.
 *
 * Silently ignoring it is the worst outcome available: the value the operator
 * set is the one they believe is running, and nothing would say otherwise until
 * a customer's cancellation landed a period late. Starting with a sentence is
 * louder, and it catches the upgrade path a codemod missed.
 *
 * Kept for one minor release, then removed.
 */
function assertNoMovedOptions(options: TenantBillingModuleOptions): void {
    // A value, not a key. `{ ...base, cancellationNoticeDays: undefined }` sets
    // nothing and loses nothing, and refusing it would be a false alarm on an
    // app that builds its options with a spread — where the key being present
    // says nothing about whether anybody chose a value.
    const given = options as unknown as Record<string, unknown>;
    const passed = MOVED_TO_THE_FILE.filter((key) => given[key] !== undefined);
    if (passed.length === 0) return;
    throw new Error(
        `TenantBillingModule.forRoot() no longer accepts ${passed.join(' and ')} — ` +
            'this moved to config/saas.yaml under `tenantBilling:`. Move the value there ' +
            '(both members of each setting are required) and delete it here. ' +
            'The file is the one place these live, so a fallback here would be the ' +
            'second home that change exists to close. ' +
            'See docs/guides/upgrade-to-1.0.md.',
    );
}

export interface VersionNoticesOptions {
    /** Sends a notice to the tenant's administrators, and says to whom and how. */
    port: ProviderSpec<SubscriptionNoticePort>;
    /** Where the record of each notice is kept. */
    notices: ProviderSpec<SubscriptionNoticeRepository>;
    /**
     * Default `true`: a run every quarter of an hour sends what is due. Needs
     * `ScheduleModule`; set `false` where none runs, or where the application
     * calls `VersionNoticeService.sendDue` from a scheduler of its own.
     */
    includeCron?: boolean;
    /**
     * Lets an operator retire a plan version for the subscriptions already on
     * it, once `config/saas.yaml` confirms the terms allow it
     * (`tenantBilling.orderlyRetirement.termsConfirmed`). Where each
     * announcement is kept, and the runner that writes it together with the
     * notices it makes. Confirmed terms without this refuse the start.
     */
    retirements?: VersionRetirementsOptions;
}

export interface VersionRetirementsOptions {
    repository: ProviderSpec<VersionRetirementRepository>;
    transactionRunner: ProviderSpec<TransactionRunner>;
    /**
     * Where each add-on retirement announcement is kept. Lets an operator
     * retire an add-on version for the bookings already on it, on the same
     * terms and the same runner; needs `subscriptionBundleRepository` and
     * `bundleRepository` as well. Without it, retiring an add-on version is
     * off, and retiring a plan version is not affected.
     */
    bundleVersionRetirements?: ProviderSpec<BundleVersionRetirementRepository>;
}

export interface TenantBillingModuleOptions {
    /**
     * App guards in the order in which they should be executed
     * (e.g. `[JwtAuthGuard, TenantGuard]`). The platform combines them via
     * `ComposedTenantAuthGuard`. At least one guard is mandatory —
     * missing configuration leads to 403 (safe default).
     *
     * Variant 1: array of guard instances (e.g. via factory provider).
     * Variant 2: Pick<FactoryProvider, 'useFactory' | 'inject'> — apps
     * pass their guard classes through via `inject` and the factory builds
     * the array.
     */
    authGuards: ProviderSpec<ReadonlyArray<CanActivate>>;

    /** Adapter to the subscription display form (`GET /billing/usage`). */
    subscriptionUsagePort: ProviderSpec<SubscriptionUsagePort>;

    /** Adapter to usage counters of all `quotaKeys`. */
    usageSnapshotPort: ProviderSpec<UsageSnapshotPort>;

    /** Adapter for plan/add-on mutations (phase C). */
    subscriptionWritePort: ProviderSpec<TenantSubscriptionWritePort>;

    /**
     * Optional adapter that provides the projected new trial end of a change
     * (app trial logic, e.g. carry-over). Without a port,
     * `PlanChangePreviewDto.projectedTrialEndsAt` stays `null`.
     */
    trialProjectionPort?: ProviderSpec<TrialProjectionPort>;

    /**
     * Optional adapter for the tenant's bundle bookings.
     *
     * A plan change reads it — the tenant's own, a retirement's switch, and a
     * retirement's announcement — to ask of every add-on still booked whether
     * it can run on the target plan (`SC-CHG-024`, `SC-SUB-037`).
     * `SubscriptionBundleModule` exports the same token, but it is a sibling
     * import rather than an ancestor — its exports do not reach this module's
     * providers, so without this option those rules resolve to "no bookings"
     * and silently allow the moves they exist to prevent. Required together
     * with `bundleRepository`.
     */
    subscriptionBundleRepository?: ProviderSpec<SubscriptionBundleRepository>;

    /**
     * Optional adapter for the add-on catalogue, read beside the bookings.
     *
     * A plan change, and a retirement onto another plan, ask of every booking
     * still running when it lands whether its add-on can run on the target
     * plan at all: allowed there, priced there in the booking's rhythm. That
     * needs the version booked, and the same sibling rule as for the bookings
     * applies — without it the two read only the rhythm. Required together
     * with `subscriptionBundleRepository`.
     */
    bundleRepository?: ProviderSpec<BundleRepository>;

    /**
     * Optional adapter that provides due scheduled plan changes (#19). If it is
     * passed, the module registers the `PendingPlanMaterializationService`
     * (exported) — the consumer triggers it via its own cron. Without a
     * port, the materialization stays disabled (lazy resolution as before).
     */
    pendingPlanQueryPort?: ProviderSpec<PendingPlanQueryPort>;

    /**
     * Optional contract freeze hook (#18). If it is configured, the
     * platform `changePlan` path (non-TRIAL) AND the materialization freeze
     * the agreed service after the plan mutation as a `SubscriptionContract`
     * (analogous to `trialProjectionPort`). Consumer-specific is only the
     * bundle/version data access (`sourcePort`); the contract logic is
     * generic. `subscriptionContractRepository` is the same repo that also goes
     * to `EntitlementModule.forRoot` — the freeze needs it in its own scope.
     */
    contractFreeze?: {
        sourcePort: ProviderSpec<ContractFreezeSourcePort>;
        subscriptionContractRepository: ProviderSpec<SubscriptionContractRepository>;
        /**
         * The parties a frozen contract is between. A plan change or a booking
         * for a tenant without a subscriber is refused before anything changes.
         */
        subscriberRepository: ProviderSpec<SubscriberRepository>;
        /**
         * The transaction a successor contract is written on together with the
         * end of the one it replaces. `SaaSiCatModule` passes its own. Without
         * one the two are written one after the other, and two writers at the
         * same moment can leave two contracts in force.
         */
        transactionRunner?: ProviderSpec<TransactionRunner>;
    };

    /**
     * Optional journal of the charges each subscriber's contracts give rise to
     * (`SubscriberChargeService`). Needs `contractFreeze`: a charge points at a
     * contract line, and the contracts and subscribers come from there.
     *
     * The platform brings an account up to date after onboarding, an
     * immediate plan change and an add-on booking; an application calls
     * `recordDueCharges` where it writes a change itself — at activation and
     * from its renewal job. `SubscriberAccountService` reads an account back
     * for the operator.
     */
    chargeJournal?: {
        ledgerRepository: ProviderSpec<SubscriberLedgerRepository>;
    };

    /**
     * Optional notices that a newer version of a subscriber's plan is offered
     * to them (`VersionNoticeService`): once per version and subscription, when
     * the offer appears beside the plan, through the application's `port`,
     * which finds the tenant's administrators, words the message and sends it.
     * `notices` keeps the record of each. Without this nothing is sent, and the
     * offer is still shown.
     */
    versionNotices?: VersionNoticesOptions;

    /** Optional tenant ID resolver. Default: `req.user.tenantId`. */
    tenantIdResolver?: TenantIdResolver;
    /** Optional user ID resolver. Default: `req.user.sub ?? req.user.id`. */
    userIdResolver?: UserIdResolver;
    /**
     * Optional email resolver for the audit log path. Default: `req.user.email`.
     * If the consumer JWT does not include the email, the resolver can
     * return `null` — the audit log then uses `'unknown'`.
     */
    userEmailResolver?: UserEmailResolver;
    /**
     * Optional audit context resolver (session ID / trace ID). Default:
     * `req.headers['x-session-id']` or `'tenant-self-service'`.
     */
    auditContextResolver?: AuditContextResolver;
    /**
     * Modules whose providers must be visible within this module.
     * Typical use case: the app's own `AuthModule`, so that the `JwtAuthGuard`
     * is injectable in the `authGuards` factory. Without this entry NestJS throws
     * `UnknownDependenciesException` for JwtAuthGuard.
     */
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
    /**
     * Additional providers that are registered in the DynamicModule itself —
     * typically: the adapter classes referenced in `inject:[Adapter]` lists
     * (e.g. `PrismaSubscriptionUsagePort`). NestJS 11.1.19
     * resolves factory inject tokens only in the DynamicModule's own scope.
     */
    extraProviders?: Provider[];
    /** Additional providers this module makes visible to importing modules. */
    extraExports?: NonNullable<DynamicModule['exports']>;
    /** Register the module globally — default `false`. */
    global?: boolean;
}

@Module({})
export class TenantBillingModule {
    static forRoot(options: TenantBillingModuleOptions): DynamicModule {
        const providers: Provider[] = [
            asProvider(TENANT_AUTH_GUARDS_TOKEN, options.authGuards),
            asProvider(SUBSCRIPTION_USAGE_PORT_TOKEN, options.subscriptionUsagePort),
            asProvider(USAGE_SNAPSHOT_PORT_TOKEN, options.usageSnapshotPort),
            asProvider(SUBSCRIPTION_WRITE_PORT_TOKEN, options.subscriptionWritePort),
            ComposedTenantAuthGuard,
            TenantAdminGuard,
            PlanChangePreviewService,
            VersionOfferService,
            VersionSwitchService,
            PlansAheadService,
            { provide: PLANS_AHEAD_TOKEN, useExisting: PlansAheadService },
        ];

        assertNoMovedOptions(options);

        // Both come from `config/saas.yaml`, which the catalogue carries, and
        // from nowhere else. A `useValue` here would be the second home this
        // wiring exists to close: an operator reading the file would have no
        // way to tell whether the value they see is the value that runs.
        providers.push(
            {
                provide: CANCELLATION_NOTICE_DAYS_TOKEN,
                useFactory: (catalog: PlanCatalogSettings) =>
                    settingFromCatalog(catalog, 'cancellationNoticeDays'),
                inject: [PLAN_CATALOG_SETTINGS_TOKEN],
            },
            {
                provide: SELF_SERVICE_BLOCKED_PLANS_TOKEN,
                useFactory: (catalog: PlanCatalogSettings) =>
                    settingFromCatalog(catalog, 'selfServiceBlockedPlans'),
                inject: [PLAN_CATALOG_SETTINGS_TOKEN],
            },
        );
        if (options.subscriptionBundleRepository) {
            if (!options.bundleRepository) {
                throw new Error(
                    'TenantBillingModule.forRoot() was given subscriptionBundleRepository without ' +
                        'bundleRepository. A plan change checks that every add-on still booked can ' +
                        'run on the target plan, and that needs the add-on versions the bookings ' +
                        'name. Pass the bundle repository beside the booking repository.',
                );
            }
            providers.push(
                asProvider(
                    SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN,
                    options.subscriptionBundleRepository,
                ),
                asProvider(BUNDLE_REPOSITORY_TOKEN, options.bundleRepository),
                // A newer add-on version offered beside each booking, and the
                // switch to it (`SC-BUN-057`, `SC-BUN-058`).
                BundleVersionOfferService,
                BundleVersionSwitchService,
            );
        }
        const hasBookings = Boolean(options.subscriptionBundleRepository);
        if (options.trialProjectionPort) {
            providers.push(asProvider(TRIAL_PROJECTION_PORT_TOKEN, options.trialProjectionPort));
        }
        const hasPendingPlanQueryPort = Boolean(options.pendingPlanQueryPort);
        if (options.pendingPlanQueryPort) {
            providers.push(
                asProvider(PENDING_PLAN_QUERY_PORT_TOKEN, options.pendingPlanQueryPort),
                PendingPlanMaterializationService,
            );
        }
        const hasContractFreeze = Boolean(options.contractFreeze);
        if (options.contractFreeze) {
            if (!options.contractFreeze.subscriberRepository) {
                throw new Error(
                    'TenantBillingModule: `contractFreeze` needs `subscriberRepository` — a frozen ' +
                        'contract names the subscriber it is concluded with, and a plan change for a ' +
                        'tenant without one is refused before anything changes.',
                );
            }
            providers.push(
                asProvider(CONTRACT_FREEZE_SOURCE_PORT_TOKEN, options.contractFreeze.sourcePort),
                asProvider(
                    SUBSCRIPTION_CONTRACT_REPOSITORY_TOKEN,
                    options.contractFreeze.subscriptionContractRepository,
                ),
                ...subscriberProviders(options.contractFreeze.subscriberRepository),
                SubscriptionContractService,
                SubscriptionContractFreezeService,
                {
                    provide: CONTRACT_FREEZE_PORT_TOKEN,
                    useExisting: SubscriptionContractFreezeService,
                },
                ContractRefreshService,
            );
            if (options.contractFreeze.transactionRunner) {
                providers.push(
                    asProvider(
                        CONTRACT_TRANSACTION_RUNNER_TOKEN,
                        options.contractFreeze.transactionRunner,
                    ),
                );
            }
        }
        const hasChargeJournal = Boolean(options.chargeJournal);
        if (options.chargeJournal) {
            if (!options.contractFreeze) {
                throw new Error(
                    'TenantBillingModule: `chargeJournal` needs `contractFreeze` — a charge points ' +
                        'at a line of a frozen contract, and the contracts and the subscribers they are ' +
                        'concluded with come from there.',
                );
            }
            providers.push(
                asProvider(
                    SUBSCRIBER_LEDGER_REPOSITORY_TOKEN,
                    options.chargeJournal.ledgerRepository,
                ),
                SubscriberChargeService,
                SubscriberAccountService,
            );
        }
        const versionNotices = options.versionNotices;
        if (versionNotices) {
            providers.push(
                asProvider(SUBSCRIPTION_NOTICE_PORT_TOKEN, versionNotices.port),
                asProvider(SUBSCRIPTION_NOTICE_REPOSITORY_TOKEN, versionNotices.notices),
                VersionNoticeService,
                ...(versionNotices.includeCron === false ? [] : [VersionNoticeCron]),
                // Where bookings are read: the notice of a newer add-on version
                // offered, and the run that makes a switch taken for the end of
                // a booking's term at that moment (`SC-BUN-059`, `SC-BUN-060`).
                ...(hasBookings ? [BundleVersionNoticeService, BundleVersionSwitchRunService] : []),
            );
        }
        const retirements = versionNotices?.retirements;
        if (retirements) {
            providers.push(
                asProvider(VERSION_RETIREMENT_REPOSITORY_TOKEN, retirements.repository),
                asProvider(
                    VERSION_RETIREMENT_TRANSACTION_RUNNER_TOKEN,
                    retirements.transactionRunner,
                ),
                VersionRetirementService,
                RetirementMoveService,
                RetirementReminderService,
                RetirementSwitchService,
                // The catalogue asks before it ends a version whether
                // subscriptions still move onto it.
                { provide: PLAN_VERSION_ENDING_CHECK_TOKEN, useExisting: VersionRetirementService },
            );
        }
        // Retiring an add-on version reads the bookings and the versions they
        // name, which tenant billing has only where bookings are wired.
        const bundleRetirements =
            retirements?.bundleVersionRetirements && options.subscriptionBundleRepository
                ? retirements.bundleVersionRetirements
                : undefined;
        if (bundleRetirements) {
            providers.push(
                asProvider(BUNDLE_VERSION_RETIREMENT_REPOSITORY_TOKEN, bundleRetirements),
                BundleVersionRetirementService,
                BundleRetirementMoveService,
                BundleRetirementSwitchService,
                BundleRetirementReminderService,
                // The catalogue asks before it deletes an add-on whether
                // bookings still move onto one of its versions.
                {
                    provide: BUNDLE_DELETION_CHECK_TOKEN,
                    useExisting: BundleVersionRetirementService,
                },
                {
                    provide: ADD_ONS_AHEAD_TOKEN,
                    useFactory: (service: BundleVersionRetirementService): AddOnsAhead => ({
                        of: (subscriptionId) => service.addOnsAhead(subscriptionId),
                    }),
                    inject: [BundleVersionRetirementService],
                },
            );
        }
        // Confirmed terms are the operator's statement that they mean to retire
        // versions. Starting without anything that could announce one would
        // leave them looking for an action that is not there.
        providers.push({
            provide: ORDERLY_RETIREMENT_IS_WIRED,
            useFactory: (catalog: PlanCatalogSettings) => {
                const confirmed = retirementTermsConfirmed(catalog);
                if (confirmed && !retirements) {
                    throw new Error(
                        'config/saas.yaml confirms tenantBilling.orderlyRetirement.termsConfirmed, ' +
                            'but nothing can announce a retirement: it needs ' +
                            '`tenantBilling.versionNotices` (a notice port) and a place to keep ' +
                            'announcements (`VersionRetirement`, see 18-version-retirement.prisma). ' +
                            'Wire both, or set termsConfirmed to false.',
                    );
                }
                return confirmed;
            },
            inject: [PLAN_CATALOG_SETTINGS_TOKEN],
        });
        if (options.tenantIdResolver) {
            providers.push({
                provide: TENANT_ID_RESOLVER_TOKEN,
                useValue: options.tenantIdResolver,
            });
        }
        if (options.userIdResolver) {
            providers.push({
                provide: USER_ID_RESOLVER_TOKEN,
                useValue: options.userIdResolver,
            });
        }
        if (options.userEmailResolver) {
            providers.push({
                provide: USER_EMAIL_RESOLVER_TOKEN,
                useValue: options.userEmailResolver,
            });
        }
        if (options.auditContextResolver) {
            providers.push({
                provide: AUDIT_CONTEXT_RESOLVER_TOKEN,
                useValue: options.auditContextResolver,
            });
        }
        if (options.extraProviders) providers.push(...options.extraProviders);

        return {
            module: TenantBillingModule,
            global: options.global ?? false,
            imports: options.imports ?? [],
            controllers: [TenantBillingController],
            providers,
            exports: [
                ComposedTenantAuthGuard,
                TenantAdminGuard,
                PlanChangePreviewService,
                PLANS_AHEAD_TOKEN,
                SUBSCRIPTION_USAGE_PORT_TOKEN,
                USAGE_SNAPSHOT_PORT_TOKEN,
                SUBSCRIPTION_WRITE_PORT_TOKEN,
                ...(hasPendingPlanQueryPort ? [PendingPlanMaterializationService] : []),
                ...(hasContractFreeze ? [CONTRACT_FREEZE_PORT_TOKEN, ContractRefreshService] : []),
                ...(hasChargeJournal ? [SubscriberChargeService, SubscriberAccountService] : []),
                ...(versionNotices ? [VersionNoticeService] : []),
                ...(hasBookings ? [BundleVersionOfferService, BundleVersionSwitchService] : []),
                ...(versionNotices && hasBookings
                    ? [BundleVersionNoticeService, BundleVersionSwitchRunService]
                    : []),
                // The add-on routes audit with the resolvers configured here.
                ...(options.userIdResolver ? [USER_ID_RESOLVER_TOKEN] : []),
                ...(options.userEmailResolver ? [USER_EMAIL_RESOLVER_TOKEN] : []),
                ...(options.auditContextResolver ? [AUDIT_CONTEXT_RESOLVER_TOKEN] : []),
                ...(retirements
                    ? [
                          VersionRetirementService,
                          RetirementMoveService,
                          RetirementReminderService,
                          RetirementSwitchService,
                          PLAN_VERSION_ENDING_CHECK_TOKEN,
                      ]
                    : []),
                ...(bundleRetirements
                    ? [
                          BundleVersionRetirementService,
                          BundleRetirementMoveService,
                          BundleRetirementSwitchService,
                          BundleRetirementReminderService,
                          BUNDLE_DELETION_CHECK_TOKEN,
                      ]
                    : []),
                ...(options.extraExports ?? []),
            ],
        };
    }
}

// Re-export for consumers that want to register individual guard classes.
export type { Type as NestType };
