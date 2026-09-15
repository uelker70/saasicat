// A sign-up gives its billing address and its payment method in step 4, in the
// gateway's own form, and becomes an account, a subscriber, a tenant and a
// subscription once the gateway confirms that payment method — together with
// the payment method, on the transaction the confirmation is claimed on, or not
// at all.
//
// Booted with the real modules — `PaymentsModule` beside `RegistrationModule` —
// over in-memory stores whose writes a failing handler rolls back. What those
// stores do against PostgreSQL is the persistence contract's; what is checked
// here is what the platform asks of them, and in which order.

import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { subscriberFromRegistration } from '@saasicat/core';

import { PlanCatalogModule } from '../dist/billing/index.js';
import {
    DevPaymentGateway,
    PaymentCallbackService,
    PaymentsModule,
} from '../dist/payments/index.js';
import {
    PendingRegistrationService,
    RegistrationModule,
    StartRegistrationCheckoutDto,
} from '../dist/registration/index.js';
import { SubscriberService } from '../dist/subscriber/index.js';
import { FakeSubscriberRepository } from '../dist/testing/index.js';
import {
    MAIN_ACCOUNT,
    MemoryPaymentEventLog,
    MemoryPaymentMethods,
    RollbackRunner,
    ScriptedGateway,
    confirmation,
    forgedCallback,
    paymentsCatalog,
    signedCallback,
} from './helpers/payments.js';
import {
    FakeAuditLogger,
    FakeOtpDelivery,
    FakePasswordHasher,
    FakePlanCatalog,
    FakeRepository,
    FakeSlugCheck,
    FakeUserLookup,
    startVerifyPlan,
} from './helpers/registration.js';

const BILLING = {
    addressLine1: '  Hauptstraße 1 ',
    postalCode: '10115',
    city: 'Berlin',
    country: 'DE',
    vatId: 'DE123456789',
};

const URLS = { successUrl: 'https://app.example/welcome', cancelUrl: 'https://app.example/step-4' };

/** Creates what an application creates, on the transaction it is handed, and can be told to fail once. */
class RecordingOrchestrator {
    constructor(subscribers) {
        this.subscribers = subscribers;
        this.calls = [];
        this.failNext = false;
    }

    async activate(pending, activation) {
        this.calls.push({ pendingId: pending.id, tx: activation.tx });
        if (this.failNext) {
            this.failNext = false;
            throw new Error('the tenant could not be created');
        }
        const n = this.calls.length;
        const subscriber = await this.subscribers.createForTenant(
            `tenant-${n}`,
            subscriberFromRegistration(pending),
            activation.tx,
        );
        return {
            userId: `user-${n}`,
            tenantId: `tenant-${n}`,
            subscriberId: subscriber.id,
            subscriptionId: `subscription-${n}`,
        };
    }
}

/** A gateway for every account the catalogue names, `main` for the one taking new payment methods. */
function gatewaysFor(catalog, main) {
    return Object.fromEntries(
        Object.keys(catalog.payments.accounts).map((name) => [
            name,
            name === MAIN_ACCOUNT ? main : new ScriptedGateway(),
        ]),
    );
}

const apps = [];
afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
});

async function signUpApp({
    catalog = paymentsCatalog(),
    gateways,
    repo = new FakeRepository(),
    withPayments = true,
} = {}) {
    const gateway = new ScriptedGateway();
    const log = new MemoryPaymentEventLog();
    const methods = new MemoryPaymentMethods();
    const subscriberRepository = new FakeSubscriberRepository();
    const orchestrator = new RecordingOrchestrator(
        new SubscriberService(subscriberRepository, catalog),
    );
    const audit = new FakeAuditLogger();
    const delivery = new FakeOtpDelivery();
    const imports = [PlanCatalogModule.forRootWithCatalog(catalog)];
    if (withPayments) {
        imports.push(
            PaymentsModule.forRoot({
                gateways: gateways ?? gatewaysFor(catalog, gateway),
                paymentEventLog: log,
                subscriberPaymentMethodRepository: methods,
                subscriberRepository,
                transactionRunner: new RollbackRunner([log, methods, repo]),
            }),
        );
    }
    imports.push(
        RegistrationModule.forRoot({
            pendingRegistrationRepository: repo,
            otpDelivery: delivery,
            userAccountLookup: new FakeUserLookup(),
            slugAvailabilityCheck: new FakeSlugCheck(),
            passwordHasher: new FakePasswordHasher(),
            planCatalogLookup: new FakePlanCatalog(),
            activationOrchestrator: orchestrator,
            auditLogger: audit,
            includeCleanupCron: false,
        }),
    );
    const app = await Test.createTestingModule({ imports }).compile();
    // Only a module that started is closed afterwards: closing one whose start
    // was refused runs its start again, and the refusal with it.
    await app.init();
    apps.push(app);
    return {
        app,
        service: app.get(PendingRegistrationService),
        callbacks: app.get(PaymentCallbackService),
        gateway,
        repo,
        log,
        methods,
        orchestrator,
        audit,
        delivery,
    };
}

/** Both accounts configured, the main one taking new payment methods. */
const TWO_ACCOUNTS = paymentsCatalog({
    newPaymentMethods: MAIN_ACCOUNT,
    accounts: {
        [MAIN_ACCOUNT]: { provider: 'stripe', methods: ['card', 'sepa_debit'] },
        'stripe-old': { provider: 'stripe' },
    },
});

async function atStepFour(ctx, email = 'anna@meier.example') {
    return startVerifyPlan(ctx, email);
}

async function throughTheForm(ctx, email) {
    const pendingId = await atStepFour(ctx, email);
    const started = await ctx.service.startCheckout({
        pendingRegistrationId: pendingId,
        billingDetails: BILLING,
        ...URLS,
    });
    return { pendingId, sessionRef: started.checkoutSessionId };
}

const codeOf = (error) => error.getResponse?.().code;

// @requirement SC-REG-022 — The account, subscriber, tenant, subscription and payment method are created together
describe('step 4 takes the billing address and opens the gateway form', () => {
    test('the address is kept as the subscriber will have it, and the form opens at the account for new payment methods', async () => {
        const ctx = await signUpApp({ catalog: TWO_ACCOUNTS });
        const pendingId = await atStepFour(ctx);

        const started = await ctx.service.startCheckout({
            pendingRegistrationId: pendingId,
            billingDetails: { ...BILLING, country: 'de' },
            ...URLS,
        });

        assert.equal(started.status, 'CHECKOUT_STARTED');
        assert.equal(started.checkoutUrl, 'https://gateway.example/form/cs_1');
        const stored = await ctx.repo.findById(pendingId);
        assert.deepEqual(
            {
                addressLine1: stored.addressLine1,
                addressLine2: stored.addressLine2,
                postalCode: stored.postalCode,
                city: stored.city,
                country: stored.country,
                vatId: stored.vatId,
                taxNumber: stored.taxNumber,
                checkoutGatewayAccount: stored.checkoutGatewayAccount,
                checkoutSessionId: stored.checkoutSessionId,
                gatewayCustomerRef: stored.gatewayCustomerRef,
            },
            {
                addressLine1: 'Hauptstraße 1',
                addressLine2: null,
                postalCode: '10115',
                city: 'Berlin',
                country: 'DE',
                vatId: 'DE123456789',
                taxNumber: null,
                checkoutGatewayAccount: MAIN_ACCOUNT,
                checkoutSessionId: 'cs_1',
                gatewayCustomerRef: 'cus_1',
            },
        );
        assert.deepEqual(ctx.gateway.setups, [
            {
                subject: { kind: 'registration', pendingRegistrationId: pendingId },
                holder: {
                    name: 'Mein Verein',
                    email: 'anna@meier.example',
                    address: {
                        addressLine1: 'Hauptstraße 1',
                        addressLine2: null,
                        postalCode: '10115',
                        city: 'Berlin',
                        country: 'DE',
                    },
                    customerRef: null,
                },
                methods: ['card', 'sepa_debit'],
                ...URLS,
            },
        ]);
        assert.equal(
            ctx.orchestrator.calls.length,
            0,
            'nothing is activated before the gateway confirms',
        );
    });

    for (const field of ['addressLine1', 'postalCode', 'city', 'country']) {
        test(`a sign-up without ${field} is refused before the gateway is asked`, async () => {
            const ctx = await signUpApp();
            const pendingId = await atStepFour(ctx);

            await assert.rejects(
                ctx.service.startCheckout({
                    pendingRegistrationId: pendingId,
                    billingDetails: { ...BILLING, [field]: '   ' },
                    ...URLS,
                }),
                (error) =>
                    codeOf(error) === 'SUBSCRIBER_DETAIL_INVALID' &&
                    error.getResponse().params.field === field,
            );
            assert.deepEqual(ctx.gateway.setups, []);
            assert.equal((await ctx.repo.findById(pendingId)).status, 'PLAN_SELECTED');
        });
    }

    for (const [field, url] of [
        ['successUrl', 'https://phishing.example/welcome'],
        ['successUrl', 'https://app.example.phishing.example/welcome'],
        ['cancelUrl', 'http://app.example/step-4'],
        ['cancelUrl', 'not a url'],
    ]) {
        test(`a ${field} of ${url} is refused before anything is stored or asked`, async () => {
            const ctx = await signUpApp();
            const pendingId = await atStepFour(ctx);

            await assert.rejects(
                ctx.service.startCheckout({
                    pendingRegistrationId: pendingId,
                    billingDetails: BILLING,
                    ...URLS,
                    [field]: url,
                }),
                (error) =>
                    codeOf(error) === 'PAYMENT_RETURN_URL_NOT_ALLOWED' &&
                    error.getStatus() === 400 &&
                    error.getResponse().params.field === field,
            );
            assert.deepEqual(ctx.gateway.setups, []);
            const stored = await ctx.repo.findById(pendingId);
            assert.equal(stored.status, 'PLAN_SELECTED');
            assert.equal(stored.addressLine1, null);
        });
    }

    test('a country that is not a two-letter code is refused', async () => {
        const ctx = await signUpApp();
        const pendingId = await atStepFour(ctx);
        await assert.rejects(
            ctx.service.startCheckout({
                pendingRegistrationId: pendingId,
                billingDetails: { ...BILLING, country: 'Germany' },
                ...URLS,
            }),
            (error) => error.getResponse().params.field === 'country',
        );
        assert.deepEqual(ctx.gateway.setups, []);
    });

    test('step 4 repeated at the same account reuses the customer the gateway created', async () => {
        const ctx = await signUpApp();
        const { pendingId } = await throughTheForm(ctx);

        await ctx.service.startCheckout({
            pendingRegistrationId: pendingId,
            billingDetails: BILLING,
            ...URLS,
        });

        assert.equal(ctx.gateway.setups[1].holder.customerRef, 'cus_1');
    });

    test('step 4 repeated after new payment methods moved to another account asks for a new customer there', async () => {
        const ctx = await signUpApp({ catalog: TWO_ACCOUNTS });
        const pendingId = await atStepFour(ctx);
        await ctx.repo.update(pendingId, {
            checkoutGatewayAccount: 'stripe-old',
            gatewayCustomerRef: 'cus_at_the_old_account',
        });

        await ctx.service.startCheckout({
            pendingRegistrationId: pendingId,
            billingDetails: BILLING,
            ...URLS,
        });

        assert.equal(ctx.gateway.setups[0].holder.customerRef, null);
    });

    test('without an account for new payment methods, step 4 is refused and nothing is kept', async () => {
        const ctx = await signUpApp({
            catalog: paymentsCatalog({
                accounts: {
                    [MAIN_ACCOUNT]: { provider: 'stripe' },
                    'stripe-old': { provider: 'stripe' },
                },
            }),
        });
        const pendingId = await atStepFour(ctx);

        await assert.rejects(
            ctx.service.startCheckout({
                pendingRegistrationId: pendingId,
                billingDetails: BILLING,
                ...URLS,
            }),
            (error) => codeOf(error) === 'PAYMENTS_NOT_CONFIGURED' && error.getStatus() === 409,
        );
        const stored = await ctx.repo.findById(pendingId);
        assert.equal(stored.status, 'PLAN_SELECTED');
        assert.equal(stored.addressLine1, null);
    });
});

// @requirement SC-SEC-005 — Data arriving from outside is validated at the boundary
describe('the request for step 4 is validated where it arrives', () => {
    const valid = {
        pendingRegistrationId: 'pending-1',
        billingDetails: {
            addressLine1: 'Hauptstraße 1',
            postalCode: '10115',
            city: 'Berlin',
            country: 'DE',
        },
        ...URLS,
    };
    const errorsFor = (payload) =>
        validateSync(plainToInstance(StartRegistrationCheckoutDto, payload), {
            whitelist: true,
            forbidNonWhitelisted: true,
        });
    const fieldsOf = (errors) =>
        errors.flatMap((error) =>
            error.children?.length
                ? error.children.map((child) => `${error.property}.${child.property}`)
                : [error.property],
        );

    test('a complete request passes, the tax identifiers left out', () => {
        assert.deepEqual(errorsFor(valid), []);
    });

    test('a request without billing details is refused', () => {
        const { billingDetails: _left, ...without } = valid;
        assert.deepEqual(fieldsOf(errorsFor(without)), ['billingDetails']);
    });

    test('a missing address line, a lower-case country and a script URL are each refused', () => {
        const errors = errorsFor({
            ...valid,
            billingDetails: { postalCode: '10115', city: 'Berlin', country: 'de' },
            successUrl: 'javascript:alert(1)',
        });
        assert.deepEqual(fieldsOf(errors).sort(), [
            'billingDetails.addressLine1',
            'billingDetails.country',
            'successUrl',
        ]);
    });
});

// @requirement SC-REG-022 — The account, subscriber, tenant, subscription and payment method are created together
describe('the confirmation of the payment method activates the sign-up', () => {
    test('everything is written on the transaction the confirmation is claimed on, the payment method included', async () => {
        const ctx = await signUpApp();
        const { pendingId, sessionRef } = await throughTheForm(ctx);
        const event = confirmation({
            eventId: 'evt_1',
            sessionRef,
            subject: { kind: 'registration', pendingRegistrationId: pendingId },
        });

        assert.equal(await ctx.callbacks.handle(MAIN_ACCOUNT, signedCallback(event)), 'handled');

        assert.equal(ctx.orchestrator.calls.length, 1);
        const { tx } = ctx.orchestrator.calls[0];
        assert.ok(tx, 'the application was handed no transaction');
        assert.deepEqual(ctx.methods.writes, [{ paymentMethodRef: 'pm_card_1', tx }]);
        assert.deepEqual(ctx.repo.deletes, [{ id: pendingId, tx }], 'the sign-up deleted on it');
        assert.deepEqual(
            ctx.log.claims.map((claim) => [claim.gatewayAccount, claim.eventId]),
            [[MAIN_ACCOUNT, 'evt_1']],
        );
        const [method] = ctx.methods.rows;
        assert.equal(method.subscriberId, 'subscriber-10001');
        assert.equal(method.status, 'ACTIVE');
        assert.equal(method.gatewayAccount, MAIN_ACCOUNT);
        assert.equal(method.provider, 'stripe');
        assert.equal(method.confirmedAt.toISOString(), '2026-09-15T10:00:00.000Z');
        assert.equal(await ctx.repo.findById(pendingId), null, 'the sign-up is done');
        assert.deepEqual(ctx.audit.events.map((entry) => entry.eventType).slice(-3), [
            'CHECKOUT_STARTED',
            'PAYMENT_RECEIVED',
            'ACTIVATION_COMPLETED',
        ]);
    });

    test('an activation that fails leaves nothing behind, and the gateway retry activates', async () => {
        const ctx = await signUpApp();
        const { pendingId, sessionRef } = await throughTheForm(ctx);
        const callback = signedCallback(
            confirmation({
                eventId: 'evt_retry',
                sessionRef,
                subject: { kind: 'registration', pendingRegistrationId: pendingId },
            }),
        );
        ctx.orchestrator.failNext = true;

        await assert.rejects(ctx.callbacks.handle(MAIN_ACCOUNT, callback), /could not be created/);

        assert.deepEqual(ctx.log.claims, [], 'the claim stayed although nothing was written');
        assert.deepEqual(ctx.methods.rows, []);
        assert.equal((await ctx.repo.findById(pendingId)).status, 'CHECKOUT_STARTED');
        assert.equal(ctx.audit.byType('PAYMENT_RECEIVED').length, 0);

        assert.equal(await ctx.callbacks.handle(MAIN_ACCOUNT, callback), 'handled');
        assert.equal(ctx.methods.rows.length, 1);
        assert.equal(await ctx.repo.findById(pendingId), null);
    });

    // @requirement SC-REG-019 — The same payment event applied twice changes nothing
    // @requirement SC-OPS-006 — Applying the same external event twice changes nothing
    test('the same confirmation delivered twice activates once', async () => {
        const ctx = await signUpApp();
        const { pendingId, sessionRef } = await throughTheForm(ctx);
        const callback = signedCallback(
            confirmation({
                eventId: 'evt_twice',
                sessionRef,
                subject: { kind: 'registration', pendingRegistrationId: pendingId },
            }),
        );

        assert.equal(await ctx.callbacks.handle(MAIN_ACCOUNT, callback), 'handled');
        assert.equal(await ctx.callbacks.handle(MAIN_ACCOUNT, callback), 'duplicate');

        assert.equal(ctx.orchestrator.calls.length, 1);
        assert.equal(ctx.audit.byType('ACTIVATION_COMPLETED').length, 1);
    });

    // @requirement SC-REG-019 — The same payment event applied twice changes nothing
    test('once activated the sign-up is gone: a later confirmation with another payment method activates nothing, and step 4 is refused', async () => {
        const ctx = await signUpApp();
        const { pendingId, sessionRef } = await throughTheForm(ctx);
        const subject = { kind: 'registration', pendingRegistrationId: pendingId };
        // The first deletion of the sign-up fails. Whether that undoes the
        // activation or leaves the sign-up behind, it must not open a way to a
        // second tenant.
        const deleteOnce = ctx.repo.delete.bind(ctx.repo);
        ctx.repo.delete = async (id) => {
            ctx.repo.delete = deleteOnce;
            throw new Error(`could not delete ${id}`);
        };
        await ctx.callbacks
            .handle(
                MAIN_ACCOUNT,
                signedCallback(confirmation({ eventId: 'evt_first', sessionRef, subject })),
            )
            .catch(() => undefined);

        // Another event, another payment method: what a form opened from a
        // stale tab before the activation would send.
        await ctx.callbacks.handle(
            MAIN_ACCOUNT,
            signedCallback(
                confirmation({
                    eventId: 'evt_later',
                    sessionRef,
                    subject,
                    paymentMethodRef: 'pm_card_2',
                    customerRef: 'cus_2',
                }),
            ),
        );

        assert.equal(ctx.methods.rows.length, 1, 'a second tenant was activated');
        await assert.rejects(
            ctx.service.startCheckout({
                pendingRegistrationId: pendingId,
                billingDetails: BILLING,
                ...URLS,
            }),
            (error) => codeOf(error) === 'PENDING_REGISTRATION_NOT_FOUND',
        );
    });

    test('a sign-up whose deletion fails is not activated either, and the gateway retry activates it once', async () => {
        const ctx = await signUpApp();
        const { pendingId, sessionRef } = await throughTheForm(ctx);
        const callback = signedCallback(
            confirmation({
                eventId: 'evt_delete_fails',
                sessionRef,
                subject: { kind: 'registration', pendingRegistrationId: pendingId },
            }),
        );
        const deleteOnce = ctx.repo.delete.bind(ctx.repo);
        ctx.repo.delete = async (id, tx) => {
            ctx.repo.delete = deleteOnce;
            throw new Error(`could not delete ${id}`);
        };

        await assert.rejects(ctx.callbacks.handle(MAIN_ACCOUNT, callback), /could not delete/);
        assert.deepEqual(ctx.methods.rows, [], 'the payment method outlived the rollback');
        assert.deepEqual(ctx.log.claims, []);
        assert.equal((await ctx.repo.findById(pendingId)).status, 'CHECKOUT_STARTED');

        assert.equal(await ctx.callbacks.handle(MAIN_ACCOUNT, callback), 'handled');
        assert.equal(ctx.methods.rows.length, 1);
        assert.equal(await ctx.repo.findById(pendingId), null);
    });

    test('a confirmation for a session no sign-up waits for activates nothing', async () => {
        const ctx = await signUpApp();
        const { pendingId } = await throughTheForm(ctx);

        const outcome = await ctx.callbacks.handle(
            MAIN_ACCOUNT,
            signedCallback(
                confirmation({
                    eventId: 'evt_nobody',
                    sessionRef: 'cs_nobody_opened',
                    subject: { kind: 'registration', pendingRegistrationId: pendingId },
                }),
            ),
        );

        assert.equal(outcome, 'handled');
        assert.equal(ctx.orchestrator.calls.length, 0);
        assert.equal((await ctx.repo.findById(pendingId)).status, 'CHECKOUT_STARTED');
    });

    test('a confirmation naming another sign-up than its session belongs to activates neither', async () => {
        const ctx = await signUpApp();
        const first = await throughTheForm(ctx, 'first@example.com');
        const second = await throughTheForm(ctx, 'second@example.com');

        await ctx.callbacks.handle(
            MAIN_ACCOUNT,
            signedCallback(
                confirmation({
                    eventId: 'evt_crossed',
                    sessionRef: first.sessionRef,
                    subject: { kind: 'registration', pendingRegistrationId: second.pendingId },
                }),
            ),
        );

        assert.equal(ctx.orchestrator.calls.length, 0);
    });

    test('a session is looked up with the account that sent the confirmation, not by its identifier alone', async () => {
        const ctx = await signUpApp({ catalog: TWO_ACCOUNTS });
        const { pendingId, sessionRef } = await throughTheForm(ctx);

        await ctx.callbacks.handle(
            'stripe-old',
            signedCallback(
                confirmation({
                    eventId: 'evt_other_account',
                    sessionRef,
                    subject: { kind: 'registration', pendingRegistrationId: pendingId },
                }),
            ),
        );

        assert.equal(ctx.orchestrator.calls.length, 0);
        assert.equal((await ctx.repo.findById(pendingId)).status, 'CHECKOUT_STARTED');
    });

    test('a setup the gateway reports as failed is recorded, and the sign-up can try again', async () => {
        const ctx = await signUpApp();
        const { pendingId, sessionRef } = await throughTheForm(ctx);

        await ctx.callbacks.handle(
            MAIN_ACCOUNT,
            signedCallback({
                kind: 'payment-method-setup-failed',
                eventId: 'evt_failed',
                occurredAt: '2026-09-15T10:00:00.000Z',
                sessionRef,
                subject: { kind: 'registration', pendingRegistrationId: pendingId },
            }),
        );

        assert.equal(ctx.orchestrator.calls.length, 0);
        assert.deepEqual(
            ctx.audit.byType('PAYMENT_FAILED').map((entry) => entry.pendingRegistrationId),
            [pendingId],
        );
        assert.equal((await ctx.repo.findById(pendingId)).status, 'CHECKOUT_STARTED');
    });

    // @requirement SC-REG-018 — Whether a payment confirmation is genuine is the integrator's to verify
    // @requirement SC-REG-021 — A payment confirmation is verified before anything is created from it
    test('a confirmation the gateway did not sign is refused before anything is claimed or created', async () => {
        const ctx = await signUpApp();
        const { pendingId, sessionRef } = await throughTheForm(ctx);

        await assert.rejects(
            ctx.callbacks.handle(
                MAIN_ACCOUNT,
                forgedCallback(
                    confirmation({
                        eventId: 'evt_forged',
                        sessionRef,
                        subject: { kind: 'registration', pendingRegistrationId: pendingId },
                    }),
                ),
            ),
            (error) => codeOf(error) === 'PAYMENT_CALLBACK_REJECTED' && error.getStatus() === 400,
        );
        assert.deepEqual(ctx.log.claims, []);
        assert.equal(ctx.orchestrator.calls.length, 0);
    });

    test('the development gateway confirms on the spot, through the same claim and transaction', async () => {
        const ctx = await signUpApp({
            catalog: paymentsCatalog({
                newPaymentMethods: MAIN_ACCOUNT,
                accounts: { [MAIN_ACCOUNT]: { provider: 'dev', methods: ['card'] } },
            }),
            gateways: { [MAIN_ACCOUNT]: new DevPaymentGateway() },
        });
        const pendingId = await atStepFour(ctx);

        const started = await ctx.service.startCheckout({
            pendingRegistrationId: pendingId,
            billingDetails: BILLING,
            ...URLS,
        });

        assert.equal(started.checkoutUrl, URLS.successUrl);
        assert.equal(ctx.log.claims.length, 1);
        assert.equal(ctx.orchestrator.calls.length, 1);
        assert.deepEqual(
            ctx.methods.rows.map(({ type, brand, last4, status }) => ({
                type,
                brand,
                last4,
                status,
            })),
            [{ type: 'card', brand: 'visa', last4: '4242', status: 'ACTIVE' }],
        );
        assert.equal(await ctx.repo.findById(pendingId), null);
    });
});

// @requirement SC-PRIC-030 — A payment method is entered in the gateway's own form, and SaaSiCat keeps a reference
describe('an open sign-up keeps its account configured', () => {
    test('the start refuses while a sign-up waits at an account the configuration no longer names', async () => {
        const repo = new FakeRepository();
        const waiting = await repo.create({
            tenantName: 'Wartend GmbH',
            email: 'waiting@example.com',
            expiresAt: new Date(Date.now() + 86_400_000),
        });
        await repo.update(waiting.id, {
            status: 'CHECKOUT_STARTED',
            checkoutGatewayAccount: 'stripe-removed',
            checkoutSessionId: 'cs_waiting',
        });

        await assert.rejects(
            signUpApp({
                repo,
                gateways: { [MAIN_ACCOUNT]: new ScriptedGateway() },
                catalog: paymentsCatalog(),
            }),
            /Sign-ups are waiting for a payment method at 'stripe-removed'/,
        );
    });

    test('and starts once that account is configured again', async () => {
        const repo = new FakeRepository();
        const waiting = await repo.create({
            tenantName: 'Wartend GmbH',
            email: 'waiting@example.com',
            expiresAt: new Date(Date.now() + 86_400_000),
        });
        await repo.update(waiting.id, {
            status: 'CHECKOUT_STARTED',
            checkoutGatewayAccount: 'stripe-old',
            checkoutSessionId: 'cs_waiting',
        });

        const ctx = await signUpApp({ repo, catalog: TWO_ACCOUNTS });

        assert.ok(ctx.service);
    });
});

describe('self-registration without the payments module', () => {
    test('does not start, and says what to wire', async () => {
        await assert.rejects(
            signUpApp({ withPayments: false }),
            /RegistrationModule takes the payment method of a sign-up through the payments module/,
        );
    });
});
