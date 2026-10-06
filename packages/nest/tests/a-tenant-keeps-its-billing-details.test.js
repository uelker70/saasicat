// Whom a tenant's subscription is billed to, from the tenant's side: read and
// changed behind the billing permission, the contact details by the tenant, the
// legal name and the tax identifiers only by the operator. The address an
// invoice names and the email it goes to can be changed but not cleared.

import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { BillingPermissionGuard, ComposedTenantAuthGuard } from '../dist/billing/index.js';
import { ChangeBillingDetailsDto, TenantBillingDetailsController } from '../dist/payments/index.js';
import { closePaymentsApps, paymentsApp, paymentsCatalog } from './helpers/payments.js';
import { TAX_SETTINGS, TEST_TAX_ADAPTER } from './helpers/tax-adapter.js';

afterEach(closePaymentsApps);

/** Nest's own metadata keys. */
const GUARDS = '__guards__';
const ROUTE_METHOD = 'method';

const codeOf = (error) => error.getResponse?.().code;
const paramsOf = (error) => error.getResponse?.().params;

const sessionOf = (tenantId) => ({ user: { tenantId, role: 'TENANT_ADMIN' } });

const MEIER = {
    legalName: 'Meier GmbH',
    vatId: 'DE123456789',
    taxNumber: null,
    addressLine1: 'Hauptstraße 1',
    addressLine2: 'Hinterhaus',
    postalCode: '10115',
    city: 'Berlin',
    country: 'DE',
    invoiceEmail: 'rechnung@meier.example',
};

/** The tenant routes, with Meier's subscriber and a second tenant's beside it. */
async function billingArea() {
    const ctx = await paymentsApp();
    const meier = await ctx.subscribers.createForTenant('tenant-meier', MEIER);
    const schulz = await ctx.subscribers.createForTenant('tenant-schulz', {
        ...MEIER,
        legalName: 'Schulz KG',
        invoiceEmail: 'buchhaltung@schulz.example',
    });
    return { ...ctx, meier, schulz };
}

/** What a request body becomes behind the application's `ValidationPipe`. */
async function throughThePipe(body) {
    const dto = plainToInstance(ChangeBillingDetailsDto, body);
    const errors = await validate(dto, { whitelist: true });
    return { dto, errors };
}

// @requirement SC-UI-023 — A tenant's invoices, payment method and billing details need the billing permission
// @requirement SC-SEC-004 — Every decision that matters is made where the request is served
test('every route of the billing details is behind authentication and the permission, reading included', () => {
    const classGuards = Reflect.getMetadata(GUARDS, TenantBillingDetailsController);
    assert.deepEqual(classGuards, [ComposedTenantAuthGuard, BillingPermissionGuard]);
    const prototype = TenantBillingDetailsController.prototype;
    const handlers = Object.getOwnPropertyNames(prototype).filter(
        (name) => Reflect.getMetadata(ROUTE_METHOD, prototype[name]) !== undefined,
    );
    assert.deepEqual(handlers.sort(), ['change', 'current']);
    for (const name of handlers) {
        assert.equal(
            Reflect.getMetadata(GUARDS, prototype[name]),
            undefined,
            `${name} replaces the class guards with its own`,
        );
    }
});

// @requirement SC-UI-023 — A tenant's invoices, payment method and billing details need the billing permission
describe('the tenant reads whom it is billed to', () => {
    test('its own subscriber, with the customer number, the legal identity and the contact details', async () => {
        const { details, meier } = await billingArea();
        assert.deepEqual(await details.current(sessionOf('tenant-meier')), {
            details: {
                customerNumber: meier.customerNumber,
                ...MEIER,
                business: null,
                readiness: null,
            },
        });
    });

    // @requirement SC-SEC-002 — Which tenant a request belongs to is derived from the authenticated session
    test("the tenant comes from the session: another tenant's session reads its own subscriber", async () => {
        const { details, schulz } = await billingArea();
        const answer = await details.current(sessionOf('tenant-schulz'));
        assert.equal(answer.details.customerNumber, schulz.customerNumber);
        assert.equal(answer.details.legalName, 'Schulz KG');
    });

    test('a tenant without a subscriber, and a request without a tenant, are refused', async () => {
        const { details } = await billingArea();
        await assert.rejects(
            details.current(sessionOf('tenant-without')),
            (error) => codeOf(error) === 'SUBSCRIBER_REQUIRED',
        );
        await assert.rejects(
            details.current({ user: { role: 'TENANT_ADMIN' } }),
            (error) => codeOf(error) === 'TENANT_CONTEXT_MISSING',
        );
    });
});

describe('the tenant changes how it is reached', () => {
    test('what it names is written, settled as every detail is, and the rest is kept', async () => {
        const { details, meier } = await billingArea();
        const { dto, errors } = await throughThePipe({
            addressLine1: '  Neue Straße 5 ',
            addressLine2: null,
            country: 'at',
            invoiceEmail: 'finanzen@meier.example',
        });
        assert.deepEqual(errors, []);

        const expected = {
            customerNumber: meier.customerNumber,
            ...MEIER,
            addressLine1: 'Neue Straße 5',
            addressLine2: null,
            country: 'AT',
            invoiceEmail: 'finanzen@meier.example',
            business: null,
            readiness: null,
        };
        assert.deepEqual((await details.change(sessionOf('tenant-meier'), dto)).details, expected);
        assert.deepEqual((await details.current(sessionOf('tenant-meier'))).details, expected);
    });

    // @requirement SC-PRIC-043 — A change to a subscriber's tax origin applies from its next invoice
    test('a change of the country is recorded with the user who made it, as the audit log tags them', async () => {
        const { details, subscribers, meier } = await billingArea();
        const request = {
            user: {
                tenantId: 'tenant-meier',
                role: 'TENANT_ADMIN',
                sub: 'u-1',
                email: 'owner@meier.example',
            },
            headers: {},
        };

        await details.change(request, { city: 'Wien', country: 'at' });
        await details.change(request, { city: 'Graz' });
        await details.change(
            { ...request, headers: { 'x-session-id': 'session-7' } },
            { city: 'Berlin', country: 'de' },
        );

        const listed = await subscribers.listTaxOriginChanges(meier.id);
        assert.deepEqual(
            listed.map((change) => [change.previous, change.changed, change.changedBy]),
            [
                [{ country: 'AT' }, { country: 'DE' }, 'web:owner@meier.example:session-7'],
                [
                    { country: 'DE' },
                    { country: 'AT' },
                    'web:owner@meier.example:tenant-self-service',
                ],
            ],
            'a change that left the country recorded one, or the user is not named',
        );
    });

    test("only the session's tenant is changed", async () => {
        const { details } = await billingArea();
        await details.change(sessionOf('tenant-meier'), { city: 'Potsdam' });
        const schulz = await details.current(sessionOf('tenant-schulz'));
        assert.equal(schulz.details.city, 'Berlin');
    });

    for (const field of ['addressLine1', 'postalCode', 'city', 'country', 'invoiceEmail']) {
        // @requirement SC-SUB-018 — A tenant can change the address and email it is billed at, but not clear them
        test(`the ${field} can be changed but not cleared, and a refused change writes nothing`, async () => {
            const { details } = await billingArea();
            for (const cleared of [null, '   ']) {
                await assert.rejects(
                    details.change(sessionOf('tenant-meier'), {
                        city: 'Potsdam',
                        [field]: cleared,
                    }),
                    (error) =>
                        codeOf(error) === 'SUBSCRIBER_DETAIL_INVALID' &&
                        paramsOf(error).field === field,
                );
            }
            const kept = await details.current(sessionOf('tenant-meier'));
            assert.equal(kept.details[field], MEIER[field]);
            assert.equal(kept.details.city, MEIER.city);
        });
    }

    test('the second address line can be cleared: an invoice does not need it', async () => {
        const { details } = await billingArea();
        const answer = await details.change(sessionOf('tenant-meier'), { addressLine2: '' });
        assert.equal(answer.details.addressLine2, null);
    });

    for (const [field, value] of [
        ['country', 'D1'],
        ['invoiceEmail', 'no address'],
    ]) {
        test(`a ${field} not in its form is refused by name`, async () => {
            const { details } = await billingArea();
            await assert.rejects(
                details.change(sessionOf('tenant-meier'), { [field]: value }),
                (error) =>
                    codeOf(error) === 'SUBSCRIBER_DETAIL_INVALID' &&
                    paramsOf(error).field === field,
            );
        });
    }

    test('a value that is not text never reaches the service', async () => {
        const { errors } = await throughThePipe({ city: 42, country: 'Deutschland' });
        assert.deepEqual(errors.map((error) => error.property).sort(), ['city', 'country']);
    });

    for (const [field, value] of [
        ['legalName', 'Meier & Söhne GmbH'],
        ['vatId', 'DE999999999'],
        ['taxNumber', '12/345/67890'],
    ]) {
        // @requirement SC-SUB-017 — A subscriber's legal identity can be corrected, not replaced, under a running contract
        // @requirement SC-SUB-018 — A tenant can change the address and email it is billed at, but not clear them
        test(`the ${field} reaches the service through the pipe and is refused there, not dropped`, async () => {
            // Stripped by `whitelist`, it would have come back as a success
            // that changed nothing — the legal identity is the operator's to
            // correct, and the tenant has to be told so.
            const { details } = await billingArea();
            const { dto, errors } = await throughThePipe({ city: 'Potsdam', [field]: value });
            assert.deepEqual(errors, []);
            assert.equal(dto[field], value);

            await assert.rejects(
                details.change(sessionOf('tenant-meier'), dto),
                (error) =>
                    codeOf(error) === 'SUBSCRIBER_IDENTITY_NOT_A_CONTACT' &&
                    paramsOf(error).field === field,
            );
            const kept = await details.current(sessionOf('tenant-meier'));
            assert.equal(kept.details[field], MEIER[field]);
            assert.equal(kept.details.city, MEIER.city);
        });
    }
});

/** The tenant routes in an installation whose tax adapter decides, with one subscriber of these details. */
async function billingAreaDeciding(subscriber) {
    const catalog = { ...paymentsCatalog(), ...TAX_SETTINGS };
    // With an adapter the rate is the adapter's, and the file names none.
    delete catalog.vatRate;
    const ctx = await paymentsApp({
        catalog,
        taxAdapter: { adapterName: 'test-tax', create: () => TEST_TAX_ADAPTER },
    });
    await ctx.subscribers.createForTenant('tenant-meier', { ...MEIER, ...subscriber });
    return ctx;
}

// @requirement SC-PRIC-070 — The operator and the tenant see what holds a subscriber's next contract back
describe('the tenant sees what holds its next contract back', () => {
    test('nothing, with its address complete in a case the adapter treats; and whether it acts as a business', async () => {
        const { details } = await billingAreaDeciding({ business: true });
        const shown = (await details.current(sessionOf('tenant-meier'))).details;
        assert.equal(shown.business, true);
        assert.deepEqual(shown.readiness, { ready: true, missing: [], taxRefusal: null });
    });

    test('the fields of its address that are empty — and none once it fills them in', async () => {
        const { details } = await billingAreaDeciding({ postalCode: null, city: null });
        assert.deepEqual((await details.current(sessionOf('tenant-meier'))).details.readiness, {
            ready: false,
            missing: ['postalCode', 'city'],
            taxRefusal: null,
        });

        const changed = await details.change(sessionOf('tenant-meier'), {
            postalCode: '10115',
            city: 'Berlin',
        });

        assert.deepEqual(changed.details.readiness, { ready: true, missing: [], taxRefusal: null });
    });

    test('the adapter sentence where it treats no such case — and none once the country it can treat is named', async () => {
        const { details } = await billingAreaDeciding({ country: 'FR', business: false });
        assert.equal(
            (await details.current(sessionOf('tenant-meier'))).details.readiness.taxRefusal,
            'A consumer outside Germany is not supported.',
        );

        const changed = await details.change(sessionOf('tenant-meier'), { country: 'DE' });

        assert.equal(changed.details.readiness.ready, true);
    });
});
