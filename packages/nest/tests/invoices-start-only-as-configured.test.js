// Where an installation issues invoices: only where the application wires them
// and `config/saas.yaml` names the range and the payment term, beside a tax
// adapter and an issuer — and never under a prefix other than the one the
// invoices already issued carry. Each mismatch refuses the start, so it is met
// at a deploy rather than at the first invoice.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';

import { AdminManifestService } from '../dist/admin/index.js';
import { SubscriptionInvoiceCron, SubscriptionInvoiceService } from '../dist/billing/index.js';
import { SaaSiCatModule } from '../dist/platform/index.js';
import { ISSUER, invoicingAdapter } from './helpers/invoice-run.js';
import { bootable, everythingOnOptions } from './helpers/operator-routes.js';

const INVOICING = { numberPrefix: 'AHP', paymentTermDays: 14 };

/** The invoices already issued, as far as the start asks. */
const invoicesUnder = (...prefixes) => ({
    listIssuedNumberPrefixes: async () => prefixes,
});

/**
 * The full installation, with a tax adapter and an issuer, its file naming
 * `invoicing` and its tenant billing wiring `invoices` unless told otherwise.
 */
function installation({
    invoicing = INVOICING,
    invoices = { invoiceRepository: invoicesUnder(), includeCron: false },
    tax = true,
    issuer = ISSUER,
} = {}) {
    const options = everythingOnOptions();
    const { vatRate: _, ...file } = options.planCatalog;
    // Version notices check their ports when the application starts, which
    // this fixture binds only far enough to compile; they are not the subject.
    const { versionNotices: __, ...tenantBilling } = options.tenantBilling;
    const planCatalog = {
        ...file,
        ...(tax ? { tax: { adapter: 'test-tax' }, timeZone: 'Europe/Berlin' } : { vatRate: 19 }),
        ...(issuer ? { issuer } : {}),
        ...(invoicing ? { invoicing } : {}),
    };
    const chargeJournal = {
        ...tenantBilling.chargeJournal,
        ...(invoices ? { invoices } : {}),
    };
    const composed = bootable({
        ...options,
        planCatalog,
        // Nothing to discover in a fixture whose ports answer nothing.
        catalog: { ...options.catalog, autoSyncDiscoveryAtBoot: false },
        ...(tax
            ? { tax: { adapter: { adapterName: 'test-tax', create: () => invoicingAdapter() } } }
            : {}),
        tenantBilling: { ...tenantBilling, chargeJournal },
    });
    // The bypass frame as an adapter without row-level security binds it: it
    // calls through, because the start reads the issued invoices through it.
    composed.persistence.core.rlsBypass = { runWithBypass: (fn) => fn() };
    return composed;
}

async function started(options) {
    const moduleRef = await Test.createTestingModule({
        imports: [SaaSiCatModule.forRoot(options)],
    }).compile();
    await moduleRef.init();
    return moduleRef;
}

/** The message a start that fails throws, compiled and initialised as an application starts. */
async function refusal(options) {
    try {
        const moduleRef = await started(options);
        await moduleRef.close();
    } catch (error) {
        return error.message;
    }
    assert.fail('the installation started');
}

// @requirement SC-PRIC-046 — An invoice states the day it is due
// @requirement SC-PRIC-027 — An invoice carries what the tax law of its issuer requires of it
describe('invoices start', () => {
    test('where they are wired, the file names their range and term, an adapter decides and an issuer is named', async () => {
        const moduleRef = await started(installation());

        assert.ok(moduleRef.get(SubscriptionInvoiceService, { strict: false }));
        const manifest = await moduleRef.get(AdminManifestService).getManifest();
        assert.ok(
            manifest.audit.actions.some((action) => action.key === 'SUBSCRIPTION_INVOICE_HELD'),
            'and the audit log names what it records for an invoice held back',
        );
        await moduleRef.close();
    });

    test('with the quarter-hourly run unless the application leaves it out', async () => {
        const withRun = await started(
            installation({ invoices: { invoiceRepository: invoicesUnder() } }),
        );
        const withoutRun = await started(installation());

        assert.ok(withRun.get(SubscriptionInvoiceCron, { strict: false }));
        assert.throws(() => withoutRun.get(SubscriptionInvoiceCron, { strict: false }));
        await withRun.close();
        await withoutRun.close();
    });

    test('not where the application wires them and the file names no range or term', async () => {
        const message = await refusal(installation({ invoicing: null }));

        assert.match(
            message,
            /config\/saas\.yaml names no invoicing: name its numberPrefix and paymentTermDays/,
        );
    });

    test('not where the file names them and the application wires none', async () => {
        const message = await refusal(installation({ invoices: null }));

        assert.match(message, /names invoicing, and the application wires no invoices/);
    });

    test('not without a tax adapter, nor without an issuer', async () => {
        // The loader holds the file to the same rule — `invoicing` needs `tax`
        // and `issuer` — and either refusal stops the start.
        assert.match(await refusal(installation({ tax: false })), /invoicing|tax adapter/);
        assert.match(await refusal(installation({ issuer: null })), /invoicing|issuer/);
    });

    test('and no wiring nor block at all is no invoicing, and starts', async () => {
        const moduleRef = await started(installation({ invoicing: null, invoices: null }));

        assert.throws(() => moduleRef.get(SubscriptionInvoiceService, { strict: false }));
        await moduleRef.close();
    });
});

// @requirement SC-PRIC-024 — An installation's invoice number prefix cannot change once an invoice exists
describe('the prefix of the invoice numbers', () => {
    test('may be anything while no invoice exists', async () => {
        const moduleRef = await started(installation());
        await moduleRef.close();
    });

    test('is the one the issued invoices carry, and the start goes on', async () => {
        const moduleRef = await started(
            installation({
                invoices: { invoiceRepository: invoicesUnder('AHP'), includeCron: false },
            }),
        );
        await moduleRef.close();
    });

    test('refuses the start where it is another, naming the one in use', async () => {
        const message = await refusal(
            installation({
                invoices: { invoiceRepository: invoicesUnder('OLD'), includeCron: false },
            }),
        );

        assert.match(message, /numberPrefix is "AHP", and invoices have been issued under "OLD"/);
    });

    test('refuses it where invoices carry two, even if one of them is the configured one', async () => {
        const message = await refusal(
            installation({
                invoices: { invoiceRepository: invoicesUnder('AHP', 'OLD'), includeCron: false },
            }),
        );

        assert.match(message, /issued under "OLD"/);
    });
});
