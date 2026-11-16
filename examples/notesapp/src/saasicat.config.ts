import {
    PrismaBundleRepository,
    PrismaSubscriptionBundleRepository,
    prismaPersistence,
} from '@saasicat/adapter-prisma';
import { contractConfirmationRenderer, zugferdInvoiceRenderer } from '@saasicat/invoice-zugferd';
import { loadPlanCatalogFromFile } from '@saasicat/nest/billing';
import { DevPaymentGateway } from '@saasicat/nest/payments';
import { aesGcmSecretSealer, defineSaaSiCat } from '@saasicat/nest/platform';
import { germanTaxAdapterFactory } from '@saasicat/tax-de';

import { DemoAuthGuard } from './auth/demo-auth.guard';
import { DemoAuthModule } from './auth/demo-auth.module';
import { DemoPasswordHasher } from './auth/demo-password.hasher';
import { PrismaModule } from './prisma/prisma.module';
import { PrismaService } from './prisma/prisma.service';
import { NOTES_FEATURE_UI_REGISTRY } from './saas/feature-ui-registry';
import { NotesQuotaProvider } from './saas/notes-quota.provider';
import { NotesContractFreezeSource } from './saas/notes-contract-freeze-source';
import { NotesDataEraser } from './saas/notes-data-eraser';
import { NotesDataExport } from './saas/notes-data-export';
import { NotesKeepReport } from './saas/notes-keep-report';
import { NotesInvoiceMailLog } from './saas/notes-invoice-mail-log';
import { NotesNoticeLog } from './saas/notes-notice-log';

// The platform as the notes app runs it. The application module and the
// command line both start it from here, so the CLI marks, checks and reads
// the installation the application serves — the same file, the same tables,
// the same sealer — rather than a second wiring that drifts from the first.

// The whole persistence wiring: the client, and the repositories of every
// platform table the schema adopts. Named here because the invoices below take
// theirs from it.
const persistence = prismaPersistence({
    client: PrismaService,
    passwordHasher: DemoPasswordHasher,
    adminResources: { tenantMetrics: ['notes', 'users'] },
});
// SAFETY: `prismaPersistence` builds every repository of the entitlement group
// unless `notAdopted` names a model it needs, and this schema adopts them all —
// the non-null assertions below on its members rest on the same fact.
const entitlement = persistence.entitlement!;

/** The options `SaaSiCatModule.forRoot` takes, for the application and its CLI. */
export const NOTES_SAASICAT_CONFIG = defineSaaSiCat({
    // Static quickstart path: identity + plans straight from the YAML.
    planCatalog: loadPlanCatalogFromFile({ path: 'config/saas.yaml' }),
    // Real apps pass their JwtAuthGuard here.
    controller: { guards: [DemoAuthGuard] },
    imports: [DemoAuthModule, PrismaModule],
    persistence,
    // A returning customer's subscriber joined into the one it had, in
    // its record and with `subscribers join`: the schema adopts
    // `SubscriberJoin`, and the entrypoint runs the migration that
    // guards it.
    subscriberJoins: true,
    // A platform administrator's second factor is stored sealed, so a
    // dump or a backup of the database does not carry it along. The
    // key is the installation's — 32 random bytes, base64, from the
    // environment — and an unset one stops the boot.
    adapters: { secretSealer: aesGcmSecretSealer(process.env.SECRET_SEALER_KEY) },
    // The standard stack takes every repository from the persistence
    // bundle. No forwarding Catalog/Billing modules are needed.
    entitlement: {
        resolutionConfig: {
            defaultTrialEntitlementPlan: 'STARTER',
            // What a subscription keeps once its cancellation has
            // taken effect. Omitted — as here — it keeps nothing,
            // which is what ending a contract means. Name a plan to
            // leave a floor instead: a read-only tier a former
            // customer can export from, or a free plan.
            //
            //   canceledEntitlementPlan: 'STARTER',
        },
    },
    catalog: {
        featureUiRegistry: NOTES_FEATURE_UI_REGISTRY,
        strictModeCheckMode: 'warn-only',
        autoSyncDiscoveryAtBoot: true,
    },
    tenantBilling: {
        authGuards: [DemoAuthGuard],
        // The notice period and the blocked plans are not here:
        // they live in `config/saas.yaml` under `tenantBilling:`,
        // which is the one place they live. Passing either one
        // here refuses the boot rather than being ignored.
        //
        // Once a subscription has ended, its tenant's administrator
        // takes everything the app keeps for the tenant as one
        // file, until the data is deleted. Only the app knows what
        // that is; the platform refuses to start without it.
        subscriptionEnds: {
            export: {
                useFactory: (prisma: PrismaService) => new NotesDataExport(prisma),
                inject: [PrismaService],
            },
            // A tenant's data is deleted only from a database marked
            // as the installation of the environment this process
            // runs in. The identifier comes from the environment as
            // it is, with no fallback: a default here would name
            // every environment the same, and the brake would hold
            // nothing. The platform refuses to start without it.
            //
            // On the deletion day the platform erases the tenant through
            // the app's erasers, in the order listed — a store of files
            // before the database whose rows find them — and keeps the
            // record with the subscriber. What the tenant has to keep for
            // obligations of its own, the app reports; it is told in every
            // reminder and does not stop the deletion.
            deletion: {
                installation: process.env.SAASICAT_INSTALLATION,
                erasers: {
                    useFactory: (prisma: PrismaService) => [new NotesDataEraser(prisma)],
                    inject: [PrismaService],
                },
                keep: new NotesKeepReport(),
            },
        },
        // Before the data is deleted, the tenant hears of it at the
        // lead times `config/saas.yaml` names — its users no longer
        // sign in, so a notice is how they learn the day. The app
        // says it in its own words through this port; the platform
        // decides when and keeps the record. Required.
        notices: {
            port: {
                useFactory: (prisma: PrismaService) => new NotesNoticeLog(prisma),
                inject: [PrismaService],
            },
        },
        // Every plan change and add-on booking is frozen as a
        // contract with the tenant's subscriber. The platform
        // writes it; what the subscription is bound to and what
        // it has booked, the app reads from its own tables.
        contractFreeze: {
            sourcePort: {
                useFactory: (prisma: PrismaService) =>
                    new NotesContractFreezeSource(
                        prisma,
                        new PrismaSubscriptionBundleRepository(prisma),
                        new PrismaBundleRepository(prisma),
                    ),
                inject: [PrismaService],
            },
            subscriptionContractRepository: entitlement.subscriptionContractRepository!,
            subscriberRepository: entitlement.subscriberRepository!,
        },
        // Each contract's charges, one per line and period, and
        // the invoices issued from them — numbered, rendered,
        // archived and mailed every quarter of an hour, on the
        // range and term `config/saas.yaml#invoicing` names.
        chargeJournal: {
            ledgerRepository: entitlement.subscriberLedgerRepository!,
            invoices: {
                invoiceRepository: entitlement.subscriptionInvoiceRepository!,
                // The ZUGFeRD PDF German tax law asks for.
                renderer: zugferdInvoiceRenderer(),
                // Kept in the database, where no file is changed.
                archive: entitlement.subscriptionInvoiceArchive!,
                // Where an invoice leaves for the subscriber. The
                // notes app writes it to its log; a real app
                // sends it as an e-mail.
                mail: new NotesInvoiceMailLog(),
                // Every contract is confirmed to the subscriber,
                // with the terms; the record and the archive of
                // the confirmations come from the bundle.
                confirmations: { renderer: contractConfirmationRenderer() },
                // The invoices are collected through the payment
                // gateway `payments` binds below.
                collections: entitlement.invoiceCollectionRepository!,
            },
        },
    },
    subscriptionBundles: true,
    // One gateway per account in `config/saas.yaml#payments`. An app
    // that takes real payment methods binds its provider's gateway
    // adapter here, built with its keys from the environment.
    // The tenant's payment method card needs the billing permission,
    // which the tenant's administrator holds unless
    // `tenantBilling.billingPermissionGuards` says otherwise.
    payments: {
        gateways: { dev: new DevPaymentGateway() },
    },
    // The factory of the tax adapter `config/saas.yaml#tax` names;
    // what the operator declares to it, such as `smallBusiness`,
    // stays in the file.
    tax: { adapter: germanTaxAdapterFactory() },
    adminResources: true,
    promoCodes: true,
    quotaProviders: [NotesQuotaProvider],
    tenantManifest: true,
    // Maintenance windows: announced from the administration or
    // `<app> maintenance`, and while one is locked every tenant
    // request is refused with 503. The health route of `HealthController`
    // is marked as reachable during maintenance, so a deploy's health gate
    // still gets its answer.
    maintenance: true,
});
