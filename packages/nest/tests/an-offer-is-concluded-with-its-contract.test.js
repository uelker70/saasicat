// Concluding a checkout offer consumes it and writes its contract together.
//
// An application used to do it in steps: consume the offer, start its own
// subscription, create the contract. A contract refused in the last step left
// a consumed offer and a started subscription with nothing agreed, and a second
// attempt skipped the consume and failed the same way. `conclude` runs the
// three on one transaction, after everything that can refuse has been asked.

// @requirement SC-MKT-024 — An offer is concluded into its contract in one step, or not at all

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { CheckoutOfferModule } from '../dist/checkout-offer/index.js';
import { SubscriberService } from '../dist/subscriber/index.js';
import { SubscriptionContractService } from '../dist/subscription-contract/index.js';

import {
    CATALOG,
    START10,
    buildOfferService,
    fakePromoCodes,
} from './helpers/checkout-catalogue.js';

const OPTIONS = { tenantId: 'tenant-meier', effectiveFrom: new Date('2026-10-01T00:00:00.000Z') };

/** Contracts in memory, recording the transaction each write ran on. */
function fakeContractRepo() {
    const rows = [];
    return {
        rows,
        async create(data, tx) {
            const row = { ...structuredClone(data), id: `contract-${rows.length + 1}`, tx };
            rows.push(row);
            return row;
        },
        async findByOriginalOfferId(offerId) {
            return rows.find((row) => row.originalOfferId === offerId) ?? null;
        },
    };
}

/**
 * Subscribers in memory, one live per tenant, recording the transaction each
 * was created on. `tenants` already have one.
 */
function fakeSubscriberRepo(tenants = []) {
    const rows = tenants.map((tenantId, index) => subscriberRow(tenantId, index, undefined));
    return {
        rows,
        async createForTenant(data, tx) {
            if (rows.some((row) => row.tenantId === data.tenantId)) return null;
            const { customerNumberPrefix, ...details } = data;
            const row = { ...subscriberRow(data.tenantId, rows.length, tx), ...details };
            row.customerNumber = `${customerNumberPrefix}${10001 + rows.length}`;
            rows.push(row);
            return row;
        },
        async findByTenantId(tenantId) {
            return rows.find((row) => row.tenantId === tenantId) ?? null;
        },
    };
}

function subscriberRow(tenantId, index, tx) {
    return {
        id: `subscriber-${index + 1}`,
        customerNumber: `${10001 + index}`,
        tenantId,
        legalName: `Customer of ${tenantId}`,
        vatId: null,
        taxNumber: null,
        addressLine1: null,
        addressLine2: null,
        postalCode: null,
        city: null,
        country: null,
        invoiceEmail: null,
        migrated: false,
        tx,
    };
}

/**
 * A transaction over the offer store, the contract store and the subscriber
 * store: a throw restores all three, as a database rolls back. `before` runs once, ahead of the first
 * transaction, and `afterRollback` once, after the first rollback, to put
 * another caller in between.
 */
function fakeTransactions(offers, contracts, { before, afterRollback, subscribers } = {}) {
    const runs = [];
    let rolledBack = false;
    return {
        runs,
        async run(fn) {
            if (before && runs.length === 0) {
                runs.push('interleaved');
                await before();
            }
            const tx = { id: `tx-${runs.length + 1}` };
            runs.push(tx);
            const savedOffers = structuredClone([...offers.rows.entries()]);
            const savedContracts = [...contracts.rows];
            const savedSubscribers = [...(subscribers?.rows ?? [])];
            try {
                return await fn(tx);
            } catch (error) {
                offers.rows.clear();
                for (const [id, row] of savedOffers) offers.rows.set(id, row);
                contracts.rows.splice(0, contracts.rows.length, ...savedContracts);
                subscribers?.rows.splice(0, subscribers.rows.length, ...savedSubscribers);
                if (afterRollback && !rolledBack) {
                    rolledBack = true;
                    await afterRollback();
                }
                throw error;
            }
        },
    };
}

/**
 * An offer service that can conclude, and an open offer to conclude. The two
 * tenants the cases conclude for have a subscriber unless `subscribedTenants`
 * says otherwise.
 */
async function concluding({
    before,
    afterRollback,
    promoCodes,
    promoCode,
    subscribedTenants = ['tenant-meier', 'tenant-other'],
} = {}) {
    const built = buildOfferService();
    const contractRepo = fakeContractRepo();
    const subscriberRepo = fakeSubscriberRepo(subscribedTenants);
    const transactions = fakeTransactions(built.repo, contractRepo, {
        before,
        afterRollback,
        subscribers: subscriberRepo,
    });
    const subscribers = new SubscriberService(subscriberRepo, CATALOG);
    const contracts = new SubscriptionContractService(contractRepo, subscribers);
    const { service } = buildOfferService({
        repo: built.repo,
        contracts,
        transactions,
        subscribers,
        ...(promoCodes ? { promoCodes } : {}),
    });
    const offer = await service.create({
        planKey: 'STANDARD',
        billingCycle: 'monthly',
        ...(promoCode ? { promoCode } : {}),
    });
    return { service, offers: built.repo, contractRepo, subscriberRepo, transactions, offer };
}

function refusedWith(code) {
    return (error) => {
        assert.equal(error.response?.code, code, error.message);
        return true;
    };
}

describe('concluding an offer', () => {
    test('consumes it, writes its contract and runs the application on one transaction', async () => {
        const { service, offers, contractRepo, offer } = await concluding();
        const seen = [];

        const concluded = await service.conclude(offer.id, OPTIONS, async (tx, result) => {
            seen.push({ tx, result });
        });

        assert.equal(offers.rows.get(offer.id).status, 'consumed');
        assert.equal(concluded.offer.status, 'consumed');
        assert.equal(concluded.contract.originalOfferId, offer.id);
        assert.equal(concluded.contract.tenantId, 'tenant-meier');
        assert.equal(contractRepo.rows.length, 1);
        assert.equal(seen.length, 1, 'the application ran once');
        assert.ok(seen[0].tx, 'with a transaction');
        assert.equal(offers.consumedOn.get(offer.id), seen[0].tx, 'the offer consumed on it');
        assert.equal(concluded.contract.tx, seen[0].tx, 'the contract written on it');
        assert.equal(seen[0].result.contract.id, concluded.contract.id);
    });

    test('on a transaction the caller holds, opens none of its own and writes everything on that one', async () => {
        // A sign-up concludes its offer inside its activation, on the
        // transaction the gateway's confirmation is claimed on. A transaction
        // of its own would commit the offer and the contract apart from that
        // claim, and a rollback of the activation would leave them behind.
        const { service, offers, subscriberRepo, transactions, offer } = await concluding({
            subscribedTenants: ['tenant-other'],
        });
        const activation = { id: 'the-activation-transaction' };
        const seen = [];

        const concluded = await service.conclude(
            offer.id,
            { ...OPTIONS, subscriber: { legalName: 'Meier GmbH' }, tx: activation },
            async (tx) => {
                seen.push(tx);
            },
        );

        assert.deepEqual(transactions.runs, [], 'a transaction of its own was opened');
        assert.equal(offers.consumedOn.get(offer.id), activation);
        assert.equal(
            subscriberRepo.rows.find((row) => row.tenantId === 'tenant-meier')?.tx,
            activation,
        );
        assert.equal(concluded.contract.tx, activation);
        assert.deepEqual(seen, [activation]);
    });

    test('undoes all of it when the application’s own write fails, and can be concluded again', async () => {
        const { service, offers, contractRepo, offer } = await concluding();
        const failure = new Error('the subscription could not be started');

        await assert.rejects(
            () =>
                service.conclude(offer.id, OPTIONS, async () => {
                    throw failure;
                }),
            (error) => error === failure,
        );
        assert.equal(offers.rows.get(offer.id).status, 'open', 'the offer stays open');
        assert.deepEqual(contractRepo.rows, [], 'and no contract is kept');

        const concluded = await service.conclude(offer.id, OPTIONS);
        assert.equal(concluded.offer.status, 'consumed');
        assert.equal(contractRepo.rows.length, 1);
    });

    test('refuses a contract the offer cannot become before anything is written', async () => {
        const { service, offers, contractRepo, transactions, offer } = await concluding();
        let ran = false;

        await assert.rejects(
            () =>
                service.conclude(
                    offer.id,
                    { ...OPTIONS, effectiveUntil: OPTIONS.effectiveFrom },
                    async () => {
                        ran = true;
                    },
                ),
            refusedWith('SUBSCRIPTION_CONTRACT_INVALID_WINDOW'),
        );
        assert.deepEqual(transactions.runs, [], 'no transaction was opened');
        assert.equal(ran, false);
        assert.equal(offers.rows.get(offer.id).status, 'open');
        assert.deepEqual(contractRepo.rows, []);
    });

    test('refuses an offer whose amounts no longer match before anything is written', async () => {
        const { service, offers, transactions, offer } = await concluding();
        offers.rows.get(offer.id).priceBreakdown.effectiveNet = 1;

        await assert.rejects(
            () => service.conclude(offer.id, OPTIONS),
            refusedWith('CHECKOUT_OFFER_PRICE_NOT_CURRENT'),
        );
        assert.deepEqual(transactions.runs, []);
        assert.equal(offers.rows.get(offer.id).status, 'open');
    });

    test('answers an offer concluded already with its contract, without running the application again', async () => {
        const { service, contractRepo, offer } = await concluding();
        let runs = 0;
        const within = async () => {
            runs += 1;
        };
        const first = await service.conclude(offer.id, OPTIONS, within);

        const again = await service.conclude(offer.id, OPTIONS, within);

        assert.equal(again.contract.id, first.contract.id);
        assert.equal(contractRepo.rows.length, 1);
        assert.equal(runs, 1, 'its writes committed with the first conclusion');
    });

    test('gives a caller that loses the race the conclusion that stands', async () => {
        // The other caller concludes between this one's checks and its
        // transaction, so the condition on the consume refuses this one.
        let other;
        const { service, contractRepo, offer } = await concluding({
            before: async () => {
                other = await service.conclude(offer.id, OPTIONS);
            },
        });
        let ran = false;

        const concluded = await service.conclude(offer.id, OPTIONS, async () => {
            ran = true;
        });

        assert.equal(concluded.contract.id, other.contract.id);
        assert.equal(contractRepo.rows.length, 1, 'one contract for one offer');
        assert.equal(ran, false, 'the loser’s writes do not run');
    });

    test('refuses the offer to another tenant once it is concluded, rather than handing over the contract', async () => {
        // An offer carries no tenant, and its id travels in the onboarding link.
        const { service, contractRepo, offer } = await concluding();
        await service.conclude(offer.id, OPTIONS);

        await assert.rejects(
            () => service.conclude(offer.id, { ...OPTIONS, tenantId: 'tenant-other' }),
            refusedWith('CHECKOUT_OFFER_ALREADY_CONSUMED'),
        );
        assert.equal(contractRepo.rows.length, 1);
        assert.equal(contractRepo.rows[0].tenantId, 'tenant-meier');
    });

    test('refuses a caller that loses the race to another tenant', async () => {
        const { service, contractRepo, offer } = await concluding({
            before: async () => {
                await service.conclude(offer.id, { ...OPTIONS, tenantId: 'tenant-other' });
            },
        });

        await assert.rejects(() => service.conclude(offer.id, OPTIONS));
        assert.equal(contractRepo.rows.length, 1);
        assert.equal(contractRepo.rows[0].tenantId, 'tenant-other');
    });

    test('refuses an offer changed between its checks and the transaction, writing nothing', async () => {
        // Another tab changes the open offer after this call checked it: the
        // contract checked would no longer be the offer consumed.
        let offers;
        const built = await concluding({
            before: async () => {
                offers.rows.get(built.offer.id).priceBreakdown.effectiveNet = 69;
            },
        });
        offers = built.offers;

        await assert.rejects(
            () => built.service.conclude(built.offer.id, OPTIONS),
            refusedWith('CHECKOUT_OFFER_CHANGED'),
        );
        assert.equal(offers.rows.get(built.offer.id).status, 'open', 'the consume is undone');
        assert.deepEqual(built.contractRepo.rows, []);
    });

    test('keeps its own failure when another call concludes the offer during the rollback', async () => {
        // A failure after the consume is this caller's; only a refused consume
        // can have lost a race.
        let service;
        let offerId;
        const failure = new Error('the subscription could not be started');
        const built = await concluding({
            afterRollback: async () => {
                await service.conclude(offerId, OPTIONS);
            },
        });
        ({ service } = built);
        offerId = built.offer.id;

        await assert.rejects(
            () =>
                service.conclude(offerId, OPTIONS, async () => {
                    throw failure;
                }),
            (error) => error === failure,
        );
        assert.equal(built.contractRepo.rows.length, 1, 'the other call concluded it');
    });

    test('keeps its own failure under a runner that retries after a refused consume', async () => {
        // A transaction runner is the application's, and may run the callback
        // again, on a deadlock say. The consume refused in the first attempt
        // must not make the second attempt's own failure look like a lost race.
        const offers = buildOfferService().repo;
        const contractRepo = fakeContractRepo();
        const subscribers = new SubscriberService(fakeSubscriberRepo(['tenant-meier']), CATALOG);
        const contracts = new SubscriptionContractService(contractRepo, subscribers);
        const consume = offers.consume.bind(offers);
        let consumes = 0;
        offers.consume = async (id, tx) => {
            consumes += 1;
            if (consumes === 1) throw new Error('deadlock detected');
            return consume(id, tx);
        };
        const other = buildOfferService({
            repo: offers,
            contracts,
            subscribers,
            transactions: fakeTransactions(offers, contractRepo),
        }).service;
        const retrying = {
            async run(fn) {
                for (let attempt = 1; ; attempt += 1) {
                    const savedOffers = structuredClone([...offers.rows.entries()]);
                    const savedContracts = [...contractRepo.rows];
                    try {
                        return await fn({ attempt });
                    } catch (error) {
                        offers.rows.clear();
                        for (const [id, row] of savedOffers) offers.rows.set(id, row);
                        contractRepo.rows.splice(0, contractRepo.rows.length, ...savedContracts);
                        if (attempt === 1) continue;
                        // Another call for the same tenant concludes the offer
                        // while this one rolls back.
                        await other.conclude(offer.id, OPTIONS);
                        throw error;
                    }
                }
            },
        };
        const { service } = buildOfferService({
            repo: offers,
            contracts,
            subscribers,
            transactions: retrying,
        });
        const offer = await service.create({ planKey: 'STANDARD', billingCycle: 'monthly' });
        const failure = new Error('the subscription could not be started');

        await assert.rejects(
            () =>
                service.conclude(offer.id, OPTIONS, async () => {
                    throw failure;
                }),
            (error) => error === failure,
        );
        assert.equal(consumes, 3, 'refused, retried, and the other call');
    });

    test('refuses an offer consumed without a contract, rather than concluding it twice over', async () => {
        const { service, offers, contractRepo, offer } = await concluding();
        await offers.consume(offer.id);

        await assert.rejects(
            () => service.conclude(offer.id, OPTIONS),
            refusedWith('CHECKOUT_OFFER_ALREADY_CONSUMED'),
        );
        assert.deepEqual(contractRepo.rows, []);
    });
});

// @requirement SC-SUB-016 — A subscription always has its subscriber, whichever path created the tenant
describe('the party an offer is concluded with', () => {
    // A sign-up creates its tenant on the conclusion's transaction, so there is
    // no subscriber before it: it passes one, which is created there, before
    // the contract that names it. Every other caller concludes for a tenant
    // that already has its subscriber.

    const MEIER = { legalName: 'Meier Software GmbH', invoiceEmail: 'anna@meier.example' };

    test('a subscriber passed in is created on the transaction, before the contract that names it', async () => {
        const { service, subscriberRepo, offer } = await concluding({ subscribedTenants: [] });
        const order = [];
        const create = subscriberRepo.createForTenant.bind(subscriberRepo);
        subscriberRepo.createForTenant = async (data, tx) => {
            order.push('subscriber');
            return create(data, tx);
        };

        const concluded = await service.conclude(
            offer.id,
            { ...OPTIONS, subscriber: MEIER },
            async (tx, { contract }) => {
                order.push(`application after contract ${contract.id}`);
            },
        );

        assert.equal(subscriberRepo.rows.length, 1);
        const [subscriber] = subscriberRepo.rows;
        assert.equal(subscriber.tenantId, 'tenant-meier');
        assert.equal(subscriber.legalName, 'Meier Software GmbH');
        assert.equal(subscriber.invoiceEmail, 'anna@meier.example');
        assert.equal(
            subscriber.tx,
            concluded.contract.tx,
            'on the transaction the contract is written on',
        );
        assert.equal(concluded.contract.parties.subscriberId, subscriber.id);
        assert.equal(concluded.contract.parties.subscriber.legalName, 'Meier Software GmbH');
        assert.deepEqual(order, [
            'subscriber',
            `application after contract ${concluded.contract.id}`,
        ]);
    });

    test('a failure after it undoes the subscriber with the contract, and the next attempt creates one', async () => {
        const { service, offers, contractRepo, subscriberRepo, offer } = await concluding({
            subscribedTenants: [],
        });

        await assert.rejects(() =>
            service.conclude(offer.id, { ...OPTIONS, subscriber: MEIER }, async () => {
                throw new Error('the tenant could not be created');
            }),
        );
        assert.deepEqual(subscriberRepo.rows, [], 'a subscriber outlived its tenant');
        assert.equal(offers.rows.get(offer.id).status, 'open');

        await service.conclude(offer.id, { ...OPTIONS, subscriber: MEIER });
        assert.equal(subscriberRepo.rows.length, 1);
        assert.equal(contractRepo.rows.length, 1);
    });

    test('a tenant with no subscriber and none passed in is refused before anything is written', async () => {
        const { service, offers, contractRepo, transactions, offer } = await concluding({
            subscribedTenants: [],
        });

        await assert.rejects(
            () => service.conclude(offer.id, OPTIONS),
            refusedWith('SUBSCRIBER_REQUIRED'),
        );
        assert.deepEqual(transactions.runs, [], 'no transaction was opened');
        assert.equal(offers.rows.get(offer.id).status, 'open');
        assert.deepEqual(contractRepo.rows, []);
    });

    test('a subscriber passed in for a tenant that has one is refused before anything is written', async () => {
        const { service, subscriberRepo, transactions, offer } = await concluding();

        await assert.rejects(
            () => service.conclude(offer.id, { ...OPTIONS, subscriber: MEIER }),
            refusedWith('SUBSCRIBER_ALREADY_EXISTS'),
        );
        assert.deepEqual(transactions.runs, []);
        assert.equal(subscriberRepo.rows.length, 2, 'the tenants kept the subscribers they had');
    });

    test('a subscriber without a legal name is refused before anything is written', async () => {
        const { service, subscriberRepo, transactions, offer } = await concluding({
            subscribedTenants: [],
        });

        await assert.rejects(
            () => service.conclude(offer.id, { ...OPTIONS, subscriber: { legalName: '   ' } }),
            refusedWith('SUBSCRIBER_LEGAL_NAME_REQUIRED'),
        );
        assert.deepEqual(transactions.runs, []);
        assert.deepEqual(subscriberRepo.rows, []);
    });

    test('a retry after the conclusion answers with it and creates no second subscriber', async () => {
        const { service, subscriberRepo, offer } = await concluding({ subscribedTenants: [] });
        const first = await service.conclude(offer.id, { ...OPTIONS, subscriber: MEIER });

        const again = await service.conclude(offer.id, { ...OPTIONS, subscriber: MEIER });

        assert.equal(again.contract.id, first.contract.id);
        assert.equal(subscriberRepo.rows.length, 1);
    });
});

describe('a promo code on the offer', () => {
    // The application redeems it in `within`, on the transaction. Measured in
    // AutohausPro against 1.0.0-rc.14: redeeming first and consuming after
    // refused the offer once the redemption took the code's last slot, because
    // the consume checked the code again and found it exhausted.

    test('is not checked again after the redemption took its last slot', async () => {
        const accepted = [START10];
        const { service, contractRepo, offer } = await concluding({
            promoCodes: fakePromoCodes(accepted),
            promoCode: 'START10',
        });

        const concluded = await service.conclude(offer.id, OPTIONS, async () => {
            // The redemption claims the last slot, and the code is exhausted.
            accepted.pop();
        });

        assert.equal(concluded.offer.status, 'consumed');
        assert.equal(contractRepo.rows.length, 1);
    });

    test('whose redemption is refused inside the transaction undoes the conclusion', async () => {
        const { service, offers, contractRepo, offer } = await concluding({
            promoCode: 'START10',
        });
        const exhausted = new Error('Code cannot be redeemed: EXHAUSTED');

        await assert.rejects(
            () =>
                service.conclude(offer.id, OPTIONS, async () => {
                    throw exhausted;
                }),
            (error) => error === exhausted,
        );
        assert.equal(offers.rows.get(offer.id).status, 'open');
        assert.deepEqual(contractRepo.rows, []);
    });
});

describe('without what concluding writes through', () => {
    test('the service refuses to conclude rather than writing the two apart', async () => {
        const { service } = buildOfferService();
        const offer = await service.create({ planKey: 'STANDARD', billingCycle: 'monthly' });

        await assert.rejects(() => service.conclude(offer.id, OPTIONS), /conclusion/);
        assert.equal((await service.getById(offer.id)).status, 'open');
    });

    test('the module does not start with half of it', () => {
        assert.throws(
            () =>
                CheckoutOfferModule.forRoot({
                    checkoutOfferRepository: {},
                    planRepository: {},
                    conclusion: { subscriptionContractRepository: {} },
                }),
            /transactionRunner/,
        );
    });

    test('the module does not start without the parties a contract names', () => {
        assert.throws(
            () =>
                CheckoutOfferModule.forRoot({
                    checkoutOfferRepository: {},
                    planRepository: {},
                    conclusion: { subscriptionContractRepository: {}, transactionRunner: {} },
                }),
            /subscriberRepository/,
        );
    });
});
