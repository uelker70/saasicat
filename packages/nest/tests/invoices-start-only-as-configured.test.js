// Where an installation issues invoices: only where the application wires them
// with a renderer, an archive and a mail for their documents, and
// `config/saas.yaml` names the range and the payment term, beside a tax
// adapter, an issuer, a payment gateway and the record of the applied
// settings — and never under a prefix other than the one the invoices already
// issued carry. Each mismatch refuses the start, so it is met at a deploy
// rather than at the first invoice.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { AdminManifestService } from '../dist/admin/index.js';
import {
    InvoiceDocumentService,
    SubscriptionInvoiceCron,
    SubscriptionInvoiceService,
} from '../dist/billing/index.js';
import { anArchive } from './helpers/invoice-documents.js';
import {
    invoicesUnder,
    invoicingPlatform as installation,
    refusal,
    started,
    wiredInvoices,
} from './helpers/invoicing-platform.js';

// @requirement SC-PRIC-046 — An invoice states the day it is due
// @requirement SC-PRIC-027 — An invoice carries what the tax law of its issuer requires of it
describe('invoices start', () => {
    test('where they are wired, the file names their range and term, an adapter decides and an issuer is named', async () => {
        const moduleRef = await started(installation());

        assert.ok(moduleRef.get(SubscriptionInvoiceService, { strict: false }));
        assert.ok(moduleRef.get(InvoiceDocumentService, { strict: false }));
        const manifest = await moduleRef.get(AdminManifestService).getManifest();
        const recorded = manifest.audit.actions.map((action) => action.key);
        for (const action of [
            'SUBSCRIPTION_INVOICE_HELD',
            'SUBSCRIPTION_INVOICE_DOCUMENT_HELD',
            'SUBSCRIPTION_INVOICE_DOCUMENT_MISMATCH',
            'SUBSCRIPTION_INVOICE_DELIVERY_HELD',
            'SUBSCRIPTION_INVOICE_DELIVERY_FAILED',
        ]) {
            assert.ok(recorded.includes(action), `the audit log names ${action}`);
        }
        await moduleRef.close();
    });

    test('with the quarter-hourly run unless the application leaves it out', async () => {
        const withRun = await started(
            installation({ invoices: wiredInvoices({ includeCron: true }) }),
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

    for (const port of ['renderer', 'archive', 'mail']) {
        test(`not without the ${port} of their documents, which the refusal names`, async () => {
            // Each is needed once an invoice has drawn its number: without one,
            // it would wait for its document, or its mail, for good.
            const message = await refusal(
                installation({ invoices: wiredInvoices({ [port]: undefined }) }),
            );

            assert.ok(message.includes(`pass chargeJournal.invoices.${port}`), message);
            assert.equal(message.split('\n').length, 2, 'and nothing else');
        });
    }

    // @requirement SC-AUD-014 — An invoice downloaded later is the document that was issued, not a new rendering
    test('not beside an archive that would let a document it keeps be changed, naming why', async () => {
        const archive = anArchive({ problem: 'the archive lets a kept file be changed' });

        const message = await refusal(installation({ invoices: wiredInvoices({ archive }) }));

        assert.equal(message, 'Invoices cannot start:\n- the archive lets a kept file be changed');
    });

    test('not without a tax adapter, nor without an issuer', async () => {
        // The loader holds the file to the same rule — `invoicing` needs `tax`
        // and `issuer` — and either refusal stops the start.
        assert.match(await refusal(installation({ tax: false })), /invoicing|tax adapter/);
        assert.match(await refusal(installation({ issuer: null })), /invoicing|issuer/);
    });

    // @requirement SC-SCOPE-011 — SaaSiCat invoices subscriptions and collects payment through a payment gateway
    test('not without a payment gateway, which the refusal names', async () => {
        // An invoice would stand open with nothing that could ever collect it.
        const message = await refusal(installation({ payments: 'none' }));

        assert.ok(
            message.includes('invoices are paid through a payment gateway: name its accounts'),
            message,
        );
    });

    test('and no wiring nor block at all is no invoicing, and starts', async () => {
        const moduleRef = await started(installation({ invoicing: null, invoices: null }));

        assert.throws(() => moduleRef.get(SubscriptionInvoiceService, { strict: false }));
        await moduleRef.close();
    });
});

// @requirement SC-PRIC-028 — A direct debit is announced before it is collected
describe('the payment methods invoices are collected with', () => {
    test('are read where the file names payment accounts and the platform composes the payments', async () => {
        const moduleRef = await started(installation({ payments: 'wired' }));

        assert.ok(moduleRef.get(SubscriptionInvoiceService, { strict: false }));
        await moduleRef.close();
    });

    test('refuse the start where the file names payment accounts and nothing reads them', async () => {
        // Its invoices would announce no collection, and nothing would say
        // why none is ever collected.
        const message = await refusal(installation({ payments: 'unread' }));

        assert.match(
            message,
            /the invoices cannot read the payment methods they are collected with/,
        );
    });

    // @requirement SC-PRIC-029 — A payment is recorded against its invoice once the gateway has confirmed it
    test('refuse the start where the invoices are collected and nothing records what they brought', async () => {
        const message = await refusal(installation({ payments: 'wired', recorded: false }));

        assert.match(
            message,
            /collecting invoices records what each collection brought: pass chargeJournal\.invoices\.payments/,
        );
    });

    // @requirement SC-PRIC-080 — A failed collection is tried once more, and the subscriber is told of every failure
    test('refuse the start where the invoices are collected and nothing records what the subscriber is told', async () => {
        const message = await refusal(installation({ payments: 'wired', notices: false }));

        assert.match(
            message,
            /collecting invoices tells the subscriber of a failure and announces a direct debit again/,
        );
    });

    // @requirement SC-PRIC-082 — An invoice is collected as it, or an announcement after it, says
    test('refuse the start where the file names payment accounts and nothing collects the invoices', async () => {
        const message = await refusal(installation({ payments: 'uncollected' }));

        assert.match(
            message,
            /invoices announce how they are collected, and nothing collects them/,
        );
    });
});

// @requirement SC-PRIC-072 — Invoice numbers run without gaps in one range per issuer, restarting each year
describe('the range of one issuer', () => {
    test('needs the record of the applied settings, without which another legal entity could take it over', async () => {
        // Only against the record does a start refuse an undeclared change of
        // the issuer's legal entity; without it, the next entity named in the
        // file would number on in this range.
        const message = await refusal(installation({ record: false }));

        assert.match(message, /invoices need the record of the applied settings/);
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
                invoices: wiredInvoices({ invoiceRepository: invoicesUnder('AHP') }),
            }),
        );
        await moduleRef.close();
    });

    test('refuses the start where it is another, naming the one in use', async () => {
        const message = await refusal(
            installation({
                invoices: wiredInvoices({ invoiceRepository: invoicesUnder('OLD') }),
            }),
        );

        assert.match(message, /numberPrefix is "AHP", and invoices have been issued under "OLD"/);
    });

    test('refuses it where invoices carry two, even if one of them is the configured one', async () => {
        const message = await refusal(
            installation({
                invoices: wiredInvoices({ invoiceRepository: invoicesUnder('AHP', 'OLD') }),
            }),
        );

        assert.match(message, /issued under "OLD"/);
    });
});
