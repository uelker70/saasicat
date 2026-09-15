// What a subscriber pays with, from the tenant's side: seen and changed behind
// the billing permission, changed only in the gateway's own form, and replaced
// only once the gateway confirms the new one. Beside it the parts every payment
// method passes through: the webhook route, the accounts the configuration names
// against the gateways the application binds, and the development gateway.

import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Test } from '@nestjs/testing';

import { BillingPermissionGuard, ComposedTenantAuthGuard, PlanCatalogModule } from '../dist/billing/index.js';
import { SAASICAT_PUBLIC_ROUTE_KEY } from '../dist/index.js';
import {
    DevPaymentGateway,
    PaymentCallbackService,
    PaymentWebhookController,
    PaymentsModule,
    TenantPaymentMethodController,
} from '../dist/payments/index.js';
import { SaaSiCatModule } from '../dist/platform/index.js';
import { SubscriberService } from '../dist/subscriber/index.js';
import { FakeSubscriberRepository } from '../dist/testing/index.js';
import {
    MAIN_ACCOUNT,
    MemoryPaymentEventLog,
    MemoryPaymentMethods,
    RollbackRunner,
    ScriptedGateway,
    confirmation,
    paymentsCatalog,
    signedCallback,
} from './helpers/payments.js';

const URLS = { successUrl: 'https://app.example/plan?payment-method=changed', cancelUrl: 'https://app.example/plan' };

/** Nest's own metadata keys. */
const GUARDS = '__guards__';
const ROUTE_METHOD = 'method';

const apps = [];
afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
});

class AllowAll {
    canActivate() {
        return true;
    }
}

function contextFor(user) {
    return {
        switchToHttp: () => ({ getRequest: () => ({ user, headers: {} }) }),
        getHandler: () => ({}),
        getClass: () => ({}),
    };
}

const codeOf = (error) => error.getResponse?.().code;

/** The payments module on its own, with tenant routes, over in-memory stores. */
async function paymentsApp({
    catalog = paymentsCatalog(),
    gateways,
    billingPermissionGuards,
    methods = new MemoryPaymentMethods(),
    subscribers = new FakeSubscriberRepository(),
} = {}) {
    const gateway = new ScriptedGateway();
    const log = new MemoryPaymentEventLog();
    const app = await Test.createTestingModule({
        imports: [
            PlanCatalogModule.forRootWithCatalog(catalog),
            PaymentsModule.forRoot({
                gateways:
                    gateways ??
                    Object.fromEntries(
                        Object.keys(catalog.payments?.accounts ?? {}).map((name) => [
                            name,
                            name === MAIN_ACCOUNT ? gateway : new ScriptedGateway(),
                        ]),
                    ),
                paymentEventLog: log,
                subscriberPaymentMethodRepository: methods,
                subscriberRepository: subscribers,
                transactionRunner: new RollbackRunner([log, methods]),
                tenantRoutes: { authGuards: [new AllowAll()], billingPermissionGuards },
            }),
        ],
    }).compile();
    await app.init();
    apps.push(app);
    return {
        app,
        gateway,
        log,
        methods,
        callbacks: app.get(PaymentCallbackService),
        routes: app.get(TenantPaymentMethodController),
        webhook: app.get(PaymentWebhookController),
        subscribers: new SubscriberService(subscribers, catalog),
    };
}

const adminOf = (tenantId, extra = {}) => ({
    user: { tenantId, role: 'TENANT_ADMIN', email: 'admin@meier.example', ...extra },
});

// @requirement SC-UI-023 — A tenant's invoices, payment method and billing details need the billing permission
describe('the billing permission', () => {
    test("the tenant's administrator holds it unless the application says otherwise", async () => {
        const guard = new BillingPermissionGuard();

        assert.equal(await guard.canActivate(contextFor({ role: 'TENANT_ADMIN' })), true);
        assert.equal(await guard.canActivate(contextFor({ platformRole: 'SUPER_ADMIN' })), true);
        await assert.rejects(
            guard.canActivate(contextFor({ role: 'TENANT_MEMBER' })),
            (error) => codeOf(error) === 'BILLING_PERMISSION_REQUIRED' && error.getStatus() === 403,
        );
        await assert.rejects(guard.canActivate(contextFor(undefined)), /Not authenticated/);
    });

    test("the application's guards decide who holds it, instead of the role", async () => {
        const accountingOnly = [{ canActivate: (context) => context.switchToHttp().getRequest().user.role === 'ACCOUNTING' }];
        const guard = new BillingPermissionGuard(accountingOnly);

        assert.equal(await guard.canActivate(contextFor({ role: 'ACCOUNTING' })), true);
        await assert.rejects(
            guard.canActivate(contextFor({ role: 'TENANT_ADMIN' })),
            (error) => codeOf(error) === 'BILLING_PERMISSION_REQUIRED',
        );
    });

    test('the guards passed to the module are the ones the routes ask', async () => {
        const accountingOnly = [{ canActivate: (context) => context.switchToHttp().getRequest().user.role === 'ACCOUNTING' }];
        const ctx = await paymentsApp({ billingPermissionGuards: accountingOnly });
        const guard = ctx.app.get(BillingPermissionGuard);

        assert.equal(await guard.canActivate(contextFor({ role: 'ACCOUNTING' })), true);
        await assert.rejects(guard.canActivate(contextFor({ role: 'TENANT_ADMIN' })), (error) => codeOf(error) === 'BILLING_PERMISSION_REQUIRED');
    });

    // @requirement SC-SEC-004 — Every decision that matters is made where the request is served
    test('every route of the payment method is behind authentication and the permission, reading included', () => {
        const classGuards = Reflect.getMetadata(GUARDS, TenantPaymentMethodController);
        assert.deepEqual(classGuards, [ComposedTenantAuthGuard, BillingPermissionGuard]);
        const prototype = TenantPaymentMethodController.prototype;
        const handlers = Object.getOwnPropertyNames(prototype).filter(
            (name) => Reflect.getMetadata(ROUTE_METHOD, prototype[name]) !== undefined,
        );
        assert.deepEqual(handlers.sort(), ['current', 'startSetup']);
        for (const name of handlers) {
            assert.equal(
                Reflect.getMetadata(GUARDS, prototype[name]),
                undefined,
                `${name} replaces the class guards with its own`,
            );
        }
    });
});

describe('the tenant sees the payment method in use', () => {
    test('what tells it apart, and nothing that reaches it at the gateway', async () => {
        const ctx = await paymentsApp();
        const subscriber = await ctx.subscribers.createForTenant('tenant-1', { legalName: 'Meier GmbH' });
        await ctx.methods.recordConfirmed({
            ...confirmation({ eventId: 'e', sessionRef: 's', subject: {} }).paymentMethod,
            subscriberId: subscriber.id,
            gatewayAccount: MAIN_ACCOUNT,
            provider: 'stripe',
            confirmedAt: new Date('2026-09-01T08:00:00.000Z'),
        });

        assert.deepEqual(await ctx.routes.current(adminOf('tenant-1')), {
            paymentMethod: {
                type: 'card',
                brand: 'visa',
                last4: '4242',
                expiryMonth: 12,
                expiryYear: 2030,
                country: 'DE',
                mandateReference: null,
                confirmedAt: '2026-09-01T08:00:00.000Z',
            },
        });
    });

    test('none, before one is given', async () => {
        const ctx = await paymentsApp();
        await ctx.subscribers.createForTenant('tenant-1', { legalName: 'Meier GmbH' });

        assert.deepEqual(await ctx.routes.current(adminOf('tenant-1')), { paymentMethod: null });
    });

    test('a tenant without a subscriber, and a request without a tenant, are refused', async () => {
        const ctx = await paymentsApp();

        await assert.rejects(ctx.routes.current(adminOf('tenant-without')), (error) => codeOf(error) === 'SUBSCRIBER_REQUIRED');
        await assert.rejects(ctx.routes.current({ user: { role: 'TENANT_ADMIN' } }), (error) => codeOf(error) === 'TENANT_CONTEXT_MISSING');
    });
});

// @requirement SC-PRIC-030 — A payment method is entered in the gateway's own form, and SaaSiCat keeps a reference
describe('changing it opens the gateway form, and the confirmation replaces the one in use', () => {
    async function withSubscriber(options, details = {}) {
        const ctx = await paymentsApp(options);
        const subscriber = await ctx.subscribers.createForTenant('tenant-1', {
            legalName: 'Meier Autohaus GmbH',
            invoiceEmail: 'rechnung@meier.example',
            addressLine1: 'Hauptstraße 1',
            postalCode: '10115',
            city: 'Berlin',
            country: 'DE',
            ...details,
        });
        return { ...ctx, subscriber };
    }

    const inUse = (ctx, gatewayAccount, customerRef) =>
        ctx.methods.recordConfirmed({
            ...confirmation({ eventId: 'e0', sessionRef: 's0', subject: {} }).paymentMethod,
            paymentMethodRef: 'pm_in_use',
            customerRef,
            subscriberId: ctx.subscriber.id,
            gatewayAccount,
            provider: 'stripe',
            confirmedAt: new Date('2026-09-01T08:00:00.000Z'),
        });

    test('the form opens for the subscriber, and nothing changes until the gateway confirms', async () => {
        const ctx = await withSubscriber();

        const answer = await ctx.routes.startSetup(adminOf('tenant-1'), URLS);

        assert.deepEqual(answer, { redirectUrl: 'https://gateway.example/form/cs_1' });
        assert.deepEqual(ctx.gateway.setups, [
            {
                subject: { kind: 'subscriber', subscriberId: ctx.subscriber.id },
                holder: {
                    name: 'Meier Autohaus GmbH',
                    email: 'rechnung@meier.example',
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
        assert.deepEqual(ctx.methods.rows, []);
    });

    test('the customer the subscriber has at that account is reused', async () => {
        const ctx = await withSubscriber();
        await inUse(ctx, MAIN_ACCOUNT, 'cus_known');

        await ctx.routes.startSetup(adminOf('tenant-1'), URLS);

        assert.equal(ctx.gateway.setups[0].holder.customerRef, 'cus_known');
    });

    test('a customer at another account is not handed to this one', async () => {
        const ctx = await withSubscriber({
            catalog: paymentsCatalog({
                newPaymentMethods: MAIN_ACCOUNT,
                accounts: {
                    [MAIN_ACCOUNT]: { provider: 'stripe', methods: ['card'] },
                    'stripe-old': { provider: 'stripe' },
                },
            }),
        });
        await inUse(ctx, 'stripe-old', 'cus_at_the_old_account');

        await ctx.routes.startSetup(adminOf('tenant-1'), URLS);

        assert.equal(ctx.gateway.setups[0].holder.customerRef, null);
    });

    test("without an invoice email, the gateway is given the requesting user's address", async () => {
        const ctx = await withSubscriber({}, { invoiceEmail: null });

        await ctx.routes.startSetup(adminOf('tenant-1', { email: 'anna@meier.example' }), URLS);

        assert.equal(ctx.gateway.setups[0].holder.email, 'anna@meier.example');
    });

    test('the confirmation makes the new payment method the one in use, and keeps the one it replaced', async () => {
        const ctx = await withSubscriber();
        await inUse(ctx, MAIN_ACCOUNT, 'cus_known');
        const callback = signedCallback(
            confirmation({
                eventId: 'evt_change',
                sessionRef: 'cs_1',
                subject: { kind: 'subscriber', subscriberId: ctx.subscriber.id },
                paymentMethodRef: 'pm_new',
                customerRef: 'cus_known',
                occurredAt: '2026-09-15T10:00:00.000Z',
            }),
        );

        assert.equal(await ctx.callbacks.handle(MAIN_ACCOUNT, callback), 'handled');
        assert.equal(await ctx.callbacks.handle(MAIN_ACCOUNT, callback), 'duplicate');

        assert.deepEqual(
            ctx.methods.rows.map(({ paymentMethodRef, status, replacedAt }) => ({
                paymentMethodRef,
                status,
                replacedAt: replacedAt?.toISOString() ?? null,
            })),
            [
                { paymentMethodRef: 'pm_in_use', status: 'REPLACED', replacedAt: '2026-09-15T10:00:00.000Z' },
                { paymentMethodRef: 'pm_new', status: 'ACTIVE', replacedAt: null },
            ],
        );
        assert.equal(ctx.methods.writes.at(-1).tx !== undefined, true, 'recorded outside the claim');
    });

    test('a confirmation whose recording fails leaves the claim open for the retry', async () => {
        const ctx = await withSubscriber();
        const record = ctx.methods.recordConfirmed.bind(ctx.methods);
        ctx.methods.recordConfirmed = async () => {
            ctx.methods.recordConfirmed = record;
            throw new Error('the database went away');
        };
        const callback = signedCallback(
            confirmation({
                eventId: 'evt_lost',
                sessionRef: 'cs_1',
                subject: { kind: 'subscriber', subscriberId: ctx.subscriber.id },
            }),
        );

        await assert.rejects(ctx.callbacks.handle(MAIN_ACCOUNT, callback), /went away/);
        assert.deepEqual(ctx.log.claims, []);

        assert.equal(await ctx.callbacks.handle(MAIN_ACCOUNT, callback), 'handled');
        assert.equal((await ctx.methods.findActive(ctx.subscriber.id))?.paymentMethodRef, 'pm_card_1');
    });

    test('without an account for new payment methods the change is refused, and the gateway is not asked', async () => {
        const ctx = await withSubscriber({
            catalog: paymentsCatalog({ accounts: { [MAIN_ACCOUNT]: { provider: 'stripe' } } }),
        });

        await assert.rejects(
            ctx.routes.startSetup(adminOf('tenant-1'), URLS),
            (error) => codeOf(error) === 'PAYMENTS_NOT_CONFIGURED' && error.getStatus() === 409,
        );
        assert.deepEqual(ctx.gateway.setups, []);
    });

    test('the development gateway replaces the payment method on the spot', async () => {
        const ctx = await withSubscriber({
            catalog: paymentsCatalog({
                newPaymentMethods: MAIN_ACCOUNT,
                accounts: { [MAIN_ACCOUNT]: { provider: 'dev', methods: ['sepa_debit'] } },
            }),
            gateways: { [MAIN_ACCOUNT]: new DevPaymentGateway() },
        });

        const answer = await ctx.routes.startSetup(adminOf('tenant-1'), URLS);

        assert.deepEqual(answer, { redirectUrl: URLS.successUrl });
        const active = await ctx.methods.findActive(ctx.subscriber.id);
        assert.equal(active.type, 'sepa_debit');
        assert.equal(active.last4, '3000');
        assert.match(active.mandateReference, /^DEV-/);
        assert.equal((await ctx.routes.current(adminOf('tenant-1'))).paymentMethod.type, 'sepa_debit');
    });
});

// @requirement SC-REG-021 — A payment confirmation is verified before anything is created from it
describe('the webhook route', () => {
    test('is public, one route per account, and hands the gateway the body as it arrived', async () => {
        const ctx = await paymentsApp();
        assert.equal(Reflect.getMetadata(SAASICAT_PUBLIC_ROUTE_KEY, PaymentWebhookController), true);
        const seen = [];
        const readCallback = ctx.gateway.readCallback.bind(ctx.gateway);
        ctx.gateway.readCallback = async (callback) => {
            seen.push(callback);
            return readCallback(callback);
        };
        const { body, headers } = signedCallback({
            kind: 'unhandled',
            eventId: 'evt_other',
            occurredAt: '2026-09-15T10:00:00.000Z',
            type: 'customer.updated',
        });

        assert.deepEqual(await ctx.webhook.receive(MAIN_ACCOUNT, { rawBody: body, headers }), { received: true });

        assert.equal(seen.length, 1);
        assert.equal(seen[0].body, body, 'the gateway was handed another body than the one that arrived');
        assert.deepEqual(ctx.log.claims, [], 'an event nothing acts on is not claimed');
    });

    test('an account the configuration does not name is refused', async () => {
        const ctx = await paymentsApp();
        const { body, headers } = signedCallback({ kind: 'unhandled', eventId: 'e', occurredAt: '2026-09-15T10:00:00.000Z', type: 't' });

        await assert.rejects(
            ctx.webhook.receive('stripe-somebody-elses', { rawBody: body, headers }),
            (error) =>
                codeOf(error) === 'PAYMENT_GATEWAY_ACCOUNT_UNKNOWN' &&
                error.getStatus() === 404 &&
                error.getResponse().params.account === 'stripe-somebody-elses',
        );
    });

    test('a JSON or form callback without its raw body is a setup error, and says how to keep the body', async () => {
        const ctx = await paymentsApp();

        for (const contentType of ['application/json; charset=utf-8', 'application/x-www-form-urlencoded']) {
            await assert.rejects(
                ctx.webhook.receive(MAIN_ACCOUNT, { headers: { 'content-type': contentType } }),
                /rawBody: true/,
            );
        }
    });

    test('a body no gateway sends is refused as unverifiable, not reported as a setup error', async () => {
        const ctx = await paymentsApp();

        for (const headers of [{ 'content-type': 'text/plain' }, {}]) {
            await assert.rejects(
                ctx.webhook.receive(MAIN_ACCOUNT, { headers }),
                (error) => codeOf(error) === 'PAYMENT_CALLBACK_REJECTED' && error.getStatus() === 400,
            );
        }
        assert.deepEqual(ctx.log.claims, []);
    });
});

describe('the accounts the file names and the gateways the application binds', () => {
    const cases = [
        {
            what: 'an account without a gateway',
            catalog: paymentsCatalog({ accounts: { [MAIN_ACCOUNT]: { provider: 'stripe' }, 'stripe-old': { provider: 'stripe' } } }),
            gateways: { [MAIN_ACCOUNT]: new ScriptedGateway() },
            message: /names the payment account 'stripe-old', and no gateway is bound/,
        },
        {
            what: 'a gateway without an account',
            catalog: paymentsCatalog({ accounts: { [MAIN_ACCOUNT]: { provider: 'stripe' } } }),
            gateways: { [MAIN_ACCOUNT]: new ScriptedGateway(), 'stripe-extra': new ScriptedGateway() },
            message: /bound for the payment account 'stripe-extra', which config\/saas\.yaml#payments\.accounts does not name/,
        },
        {
            what: 'a gateway at another provider than the file says',
            catalog: paymentsCatalog({ accounts: { [MAIN_ACCOUNT]: { provider: 'mollie' } } }),
            gateways: { [MAIN_ACCOUNT]: new ScriptedGateway('stripe') },
            message: /'stripe-main' is at 'mollie' in config\/saas\.yaml, but the gateway bound for it is 'stripe'/,
        },
        {
            what: 'new payment methods at an account the file does not list',
            catalog: paymentsCatalog({ newPaymentMethods: 'stripe-new', accounts: { [MAIN_ACCOUNT]: { provider: 'stripe' } } }),
            gateways: { [MAIN_ACCOUNT]: new ScriptedGateway() },
            message: /newPaymentMethods names 'stripe-new', which is not one of its accounts/,
        },
        {
            what: 'new payment methods at an account that offers none',
            catalog: paymentsCatalog({ newPaymentMethods: MAIN_ACCOUNT, accounts: { [MAIN_ACCOUNT]: { provider: 'stripe' } } }),
            gateways: { [MAIN_ACCOUNT]: new ScriptedGateway() },
            message: /'stripe-main' takes new payment methods, and lists no `methods`/,
        },
        {
            what: 'gateways and no payments block at all',
            catalog: { ...paymentsCatalog(), payments: undefined },
            gateways: { [MAIN_ACCOUNT]: new ScriptedGateway() },
            message: /config\/saas\.yaml has no `payments` block/,
        },
    ];
    for (const { what, catalog, gateways, message } of cases) {
        test(`${what} stops the start, and is named`, async () => {
            await assert.rejects(paymentsApp({ catalog, gateways }), message);
        });
    }

    test('every mismatch is named at once', async () => {
        await assert.rejects(
            paymentsApp({
                catalog: paymentsCatalog({ accounts: { [MAIN_ACCOUNT]: { provider: 'mollie' }, 'stripe-old': { provider: 'stripe' } } }),
                gateways: { [MAIN_ACCOUNT]: new ScriptedGateway() },
            }),
            (error) => /'stripe-old', and no gateway is bound/.test(error.message) && /is at 'mollie'/.test(error.message),
        );
    });

    // @requirement SC-PRIC-030 — A payment method is entered in the gateway's own form, and SaaSiCat keeps a reference
    test('a payment method in use at an account the file no longer names stops the start, and is named', async () => {
        const methods = new MemoryPaymentMethods();
        const subscribers = new FakeSubscriberRepository();
        const subscriber = await new SubscriberService(subscribers, paymentsCatalog()).createForTenant('tenant-1', {
            legalName: 'Meier GmbH',
        });
        await methods.recordConfirmed({
            ...confirmation({ eventId: 'e', sessionRef: 's', subject: {} }).paymentMethod,
            subscriberId: subscriber.id,
            gatewayAccount: 'stripe-retired',
            provider: 'stripe',
            confirmedAt: new Date('2026-09-01T08:00:00.000Z'),
        });

        await assert.rejects(
            paymentsApp({ methods, subscribers }),
            /Payment methods in use are held at 'stripe-retired', which config\/saas\.yaml#payments\.accounts no longer names/,
        );
    });
});

describe('the development gateway', () => {
    test('refuses to run in production, where it would confirm payment methods nobody gave', () => {
        const before = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            assert.throws(() => new DevPaymentGateway(), /refuses to run with NODE_ENV=production/);
        } finally {
            process.env.NODE_ENV = before;
        }
    });

    test('rejects a confirmation that was altered after it signed it', async () => {
        const gateway = new DevPaymentGateway();
        const session = await gateway.startPaymentMethodSetup({
            subject: { kind: 'subscriber', subscriberId: 'subscriber-1' },
            holder: { name: 'Meier GmbH', email: null, address: {}, customerRef: null },
            methods: ['card'],
            ...URLS,
        });
        const altered = session.immediateCallback.body.replace('subscriber-1', 'subscriber-2');

        await assert.rejects(
            gateway.readCallback({ body: altered, headers: session.immediateCallback.headers }),
            (error) => error.code === 'PAYMENT_CALLBACK_REJECTED',
        );
        const event = await gateway.readCallback(session.immediateCallback);
        assert.deepEqual(event.subject, { kind: 'subscriber', subscriberId: 'subscriber-1' });
    });
});

describe('SaaSiCatModule composes payments', () => {
    const catalog = paymentsCatalog();
    const persistence = {
        capabilities: { transactions: true, pessimisticLocking: true, rowLevelSecurity: false, advisoryLocks: false },
        core: { mfa: {}, audit: {}, rlsBypass: {}, transactionRunner: {} },
        entitlement: { subscriptionRepository: {}, planVersionRepository: {}, subscriberRepository: {} },
        tenantBilling: { subscriptionUsagePort: {}, subscriptionWritePort: {} },
        payments: { paymentEventLog: {}, subscriberPaymentMethodRepository: {} },
    };
    const paymentsModuleOf = (dyn) => dyn.imports.find((imported) => imported?.module?.name === 'PaymentsModule');

    test('with tenant billing: the webhook route and the tenant routes, behind the tenant guards', () => {
        const dyn = SaaSiCatModule.forRoot({
            planCatalog: catalog,
            controller: { guards: [AllowAll] },
            persistence,
            tenantBilling: { authGuards: [AllowAll] },
            payments: { gateways: { [MAIN_ACCOUNT]: new ScriptedGateway() } },
        });

        const payments = paymentsModuleOf(dyn);
        assert.ok(payments, 'PaymentsModule is not composed');
        assert.deepEqual(payments.controllers, [PaymentWebhookController, TenantPaymentMethodController]);
    });

    test('without tenant billing: the webhook route alone', () => {
        const dyn = SaaSiCatModule.forRoot({
            planCatalog: catalog,
            controller: { guards: [AllowAll] },
            persistence,
            payments: { gateways: { [MAIN_ACCOUNT]: new ScriptedGateway() } },
        });

        assert.deepEqual(paymentsModuleOf(dyn).controllers, [PaymentWebhookController]);
    });

    test('without a payments slice in the persistence bundle, the boot names what is missing', () => {
        assert.throws(
            () =>
                SaaSiCatModule.forRoot({
                    planCatalog: catalog,
                    controller: { guards: [AllowAll] },
                    persistence: { ...persistence, payments: undefined },
                    payments: { gateways: {} },
                }),
            /paymentEventLog, subscriberPaymentMethodRepository/,
        );
    });
});
