// The page that offers the plans is written before anybody signs up, and the
// answer it needs — will a payment method be asked for, and which ones — lives
// in `config/saas.yaml#payments`. It reaches the page through the public
// catalogue rather than through a second copy on the website.
//
// Two halves, and the second is where this can fail quietly: what the service
// makes of the account, and whether the account reaches the service at all in a
// wired application. The last two cases boot the real modules for that.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';

import { PlanCatalogModule } from '../dist/billing/index.js';
import { CatalogModule, PublicMarketingCatalogService } from '../dist/catalog/index.js';
import { PaymentGatewayRegistry, PaymentsModule } from '../dist/payments/index.js';
import { FakePlanRepository, FakeSubscriberRepository } from '../dist/testing/index.js';

import {
    MAIN_ACCOUNT,
    MemoryPaymentEventLog,
    MemoryPaymentMethods,
    paymentsCatalog,
    RollbackRunner,
    ScriptedGateway,
} from './helpers/payments.js';

const NO_PROMOTIONS = { list: async () => [] };
const NO_MARKETING = { findByTarget: async () => null };

/** A plan repository with no version lookup at all, which is the catalogue's own empty path. */
const NO_PLAN_VERSIONS = { list: async () => [] };

const CARD_ONLY = {
    newPaymentMethods: MAIN_ACCOUNT,
    accounts: { [MAIN_ACCOUNT]: { provider: 'stripe', methods: ['card'] } },
};

function registryFor(payments) {
    return new PaymentGatewayRegistry(paymentsCatalog(payments), {
        [MAIN_ACCOUNT]: new ScriptedGateway(),
    });
}

function catalogueWith(payments, planRepo = new FakePlanRepository()) {
    return new PublicMarketingCatalogService(
        planRepo,
        NO_MARKETING,
        NO_PROMOTIONS,
        null,
        null,
        payments === null ? null : registryFor(payments),
    );
}

/** The catalogue as an application wires it: the real modules, over in-memory stores. */
async function bootedCatalogue({ payments = CARD_ONLY, withPayments = true, source = null } = {}) {
    const catalog = paymentsCatalog(payments);
    const imports = [PlanCatalogModule.forRootWithCatalog(catalog)];
    if (withPayments) {
        const log = new MemoryPaymentEventLog();
        const methods = new MemoryPaymentMethods();
        imports.push(
            PaymentsModule.forRoot({
                gateways: Object.fromEntries(
                    Object.keys(catalog.payments.accounts).map((name) => [
                        name,
                        new ScriptedGateway(),
                    ]),
                ),
                paymentEventLog: log,
                subscriberPaymentMethodRepository: methods,
                subscriberRepository: new FakeSubscriberRepository(),
                transactionRunner: new RollbackRunner([log, methods]),
            }),
        );
    }
    imports.push(
        CatalogModule.forRoot({
            planRepository: new FakePlanRepository(),
            marketingProjectionRepository: NO_MARKETING,
            promotionRepository: NO_PROMOTIONS,
            publicMarketingCatalog: {
                guards: [],
                currency: 'EUR',
                vatRate: 19,
                newPaymentMethodsFrom: source,
            },
        }),
    );
    const moduleRef = await Test.createTestingModule({ imports }).compile();
    return moduleRef.get(PublicMarketingCatalogService);
}

// @requirement SC-MKT-025 — The public catalogue says what a new payment method is taken with
describe('what the public catalogue says a payment method is taken with', () => {
    test('an installation that takes none says so', async () => {
        const catalogue = await catalogueWith(null).getCatalog('de', 'EUR', 19);

        assert.deepEqual(catalogue.newPaymentMethods, { taken: false, methods: [] });
    });

    test('an account that takes new payment methods answers with the methods it offers', async () => {
        const catalogue = await catalogueWith(CARD_ONLY).getCatalog('de', 'EUR', 19);

        assert.deepEqual(catalogue.newPaymentMethods, { taken: true, methods: ['card'] });
    });

    test('the methods keep the order the installation names them in', async () => {
        const catalogue = await catalogueWith({
            newPaymentMethods: MAIN_ACCOUNT,
            accounts: {
                [MAIN_ACCOUNT]: { provider: 'stripe', methods: ['sepa_debit', 'card'] },
            },
        }).getCatalog('de', 'EUR', 19);

        assert.deepEqual(catalogue.newPaymentMethods.methods, ['sepa_debit', 'card']);
    });

    test('a gateway bound for an account that takes no new ones takes none', async () => {
        const catalogue = await catalogueWith({
            accounts: { [MAIN_ACCOUNT]: { provider: 'stripe', methods: ['card'] } },
        }).getCatalog('de', 'EUR', 19);

        assert.deepEqual(catalogue.newPaymentMethods, { taken: false, methods: [] });
    });

    test('a catalogue with no plan versions to show still answers it', async () => {
        const catalogue = await catalogueWith(CARD_ONLY, NO_PLAN_VERSIONS).getCatalog(
            'de',
            'EUR',
            19,
        );

        assert.deepEqual(catalogue.plans, []);
        assert.deepEqual(catalogue.newPaymentMethods, { taken: true, methods: ['card'] });
    });

    test('neither the account nor its provider is in the answer', async () => {
        const catalogue = await catalogueWith(CARD_ONLY).getCatalog('de', 'EUR', 19);

        const wire = JSON.stringify(catalogue);
        assert.ok(!wire.includes(MAIN_ACCOUNT), 'the account name is the installation’s business');
        assert.ok(!wire.includes('stripe'), 'who keeps the payment method is not a prospect’s');
    });

    test('the registry reaches the catalogue in a wired application', async () => {
        const service = await bootedCatalogue({ source: PaymentGatewayRegistry });

        const catalogue = await service.getCatalog('de', 'EUR', 19);

        assert.deepEqual(catalogue.newPaymentMethods, { taken: true, methods: ['card'] });
    });

    test('a catalogue told there is no source takes none', async () => {
        const service = await bootedCatalogue({ withPayments: false, source: null });

        const catalogue = await service.getCatalog('de', 'EUR', 19);

        assert.deepEqual(catalogue.newPaymentMethods, { taken: false, methods: [] });
    });

    test('a source out of the catalogue’s scope refuses the boot instead of answering', async () => {
        await assert.rejects(
            bootedCatalogue({ withPayments: false, source: PaymentGatewayRegistry }),
            /PaymentGatewayRegistry/,
        );
    });
});
