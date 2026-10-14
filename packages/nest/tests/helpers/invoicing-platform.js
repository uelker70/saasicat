// The whole platform with invoices on, as `SaaSiCatModule.forRoot` starts it:
// a tax adapter, an issuer, the record of the applied settings, the file's
// `invoicing` block and the application's wiring of `invoices`, each of which a
// test can leave out or replace.

import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';

import { SaaSiCatModule } from '../../dist/platform/index.js';
import { FakeAppliedSettingsPort } from './applied-settings-port.js';
import { aMailbox, aRenderer, anArchive } from './invoice-documents.js';
import { ISSUER } from './invoice-run.js';
import { bootable, everythingOnOptions } from './operator-routes.js';
import {
    MAIN_ACCOUNT,
    MemoryPaymentEventLog,
    MemoryPaymentMethods,
    ScriptedGateway,
    paymentsCatalog,
} from './payments.js';

export const INVOICING = { numberPrefix: 'AHP', paymentTermDays: 14 };

/** The invoices already issued, as far as the start asks. */
export const invoicesUnder = (...prefixes) => ({
    listIssuedNumberPrefixes: async () => prefixes,
});

/** What the application wires for invoices: the repository and the ports of their documents. */
export const wiredInvoices = (overrides = {}) => ({
    invoiceRepository: invoicesUnder(),
    renderer: aRenderer(),
    archive: anArchive(),
    mail: aMailbox(),
    includeCron: false,
    ...overrides,
});

/**
 * The options of an installation whose file names `invoicing` and whose tenant
 * billing wires `invoices`, beside a tax adapter, an issuer and the record of
 * the applied settings, unless told otherwise. `payments` is whether it takes
 * payment methods: `'none'`, `'wired'` — the file names an account and the
 * platform composes the payments beside it, and the invoices are collected —,
 * `'uncollected'`, where they are composed and nothing collects the invoices,
 * or `'unread'`, where the file names the account and nothing composes them.
 */
export function invoicingPlatform({
    invoicing = INVOICING,
    invoices = wiredInvoices(),
    tax = true,
    issuer = ISSUER,
    record = true,
    payments = 'none',
} = {}) {
    const options = everythingOnOptions();
    const {
        tax: _tax,
        timeZone: _zone,
        issuer: _issuer,
        invoicing: _invoicing,
        ...file
    } = options.planCatalog;
    // Version notices check their ports when the application starts, which
    // this fixture binds only far enough to compile; they are not the subject.
    const { versionNotices: _notices, ...tenantBilling } = options.tenantBilling;
    const { invoices: _invoices, ...journal } = tenantBilling.chargeJournal;
    const planCatalog = {
        ...file,
        ...(tax ? { tax: { adapter: 'test-tax' }, timeZone: 'Europe/Berlin' } : { vatRate: 19 }),
        ...(issuer ? { issuer } : {}),
        ...(invoicing ? { invoicing } : {}),
    };
    const composed = bootable({
        ...options,
        planCatalog,
        // Nothing to discover in a fixture whose ports answer nothing.
        catalog: { ...options.catalog, autoSyncDiscoveryAtBoot: false },
        tax: tax ? options.tax : undefined,
        tenantBilling: {
            ...tenantBilling,
            chargeJournal: { ...journal, ...(invoices ? { invoices } : {}) },
        },
    });
    // The bypass frame as an adapter without row-level security binds it: it
    // calls through, because the start reads the issued invoices through it.
    composed.persistence.core.rlsBypass = { runWithBypass: (fn) => fn() };
    // A record that has kept nothing yet: the first start that names an issuer.
    composed.persistence.core.appliedSettings = record ? new FakeAppliedSettingsPort() : undefined;
    if (payments !== 'none') composed.planCatalog.payments = paymentsCatalog().payments;
    if (payments === 'wired' || payments === 'unread') {
        composed.tenantBilling.chargeJournal.invoices = {
            ...composed.tenantBilling.chargeJournal.invoices,
            // No attempt is open, so no account has to stay for one.
            collections: { accountsInUse: async () => [] },
        };
    }
    if (payments === 'wired' || payments === 'uncollected') {
        composed.payments = {
            gateways: { [MAIN_ACCOUNT]: new ScriptedGateway() },
            // The tenant's payment routes resolve the same guards tenant billing does.
            extraProviders: composed.tenantBilling.extraProviders,
        };
        composed.persistence.payments = {
            paymentEventLog: new MemoryPaymentEventLog(),
            subscriberPaymentMethodRepository: new MemoryPaymentMethods(),
        };
    }
    return composed;
}

/** The platform compiled and initialised, as an application starts. */
export async function started(options) {
    const moduleRef = await Test.createTestingModule({
        imports: [SaaSiCatModule.forRoot(options)],
    }).compile();
    await moduleRef.init();
    return moduleRef;
}

/** The message a start that fails throws. */
export async function refusal(options) {
    try {
        const moduleRef = await started(options);
        await moduleRef.close();
    } catch (error) {
        return error.message;
    }
    assert.fail('the installation started');
}
