// Whom a tenant's subscription is billed to, from the tenant's side: read and
// changed behind the billing permission, the contact details by the tenant —
// those the application lets it change there —, the legal name and the tax
// identifiers only by the operator. The address an invoice names and the email
// it goes to can be changed but not cleared.

import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { BillingPermissionGuard, ComposedTenantAuthGuard } from '../dist/billing/index.js';
import { ChangeBillingDetailsDto, TenantBillingDetailsController } from '../dist/payments/index.js';
import {
    MAIN_ACCOUNT,
    ScriptedGateway,
    billingDetailsWithoutPayments,
    closePaymentsApps,
    composedPlatform,
    modulesMounting,
    mountsOf,
    paymentsApp,
    paymentsCatalog,
    paymentsOverHttp,
    TENANT_HEADER,
} from './helpers/payments.js';
import { TAX_SETTINGS, TEST_TAX_ADAPTER } from './helpers/tax-adapter.js';

afterEach(closePaymentsApps);

/** Nest's own metadata keys. */
const GUARDS = '__guards__';
const ROUTE_METHOD = 'method';

const codeOf = (error) => error.getResponse?.().code;
const paramsOf = (error) => error.getResponse?.().params;

const sessionOf = (tenantId) => ({ user: { tenantId, role: 'TENANT_ADMIN' } });

/** Every contact detail, in the order every screen and answer names them. */
const EVERY_CONTACT_DETAIL = [
    'addressLine1',
    'addressLine2',
    'postalCode',
    'city',
    'country',
    'invoiceEmail',
];

/** The option of an application that keeps the address on a page of its own. */
const EMAIL_ONLY = { billingDetails: { tenantEditable: ['invoiceEmail'] } };

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
async function billingArea(options) {
    const ctx = await paymentsApp(options);
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
                tenantEditable: EVERY_CONTACT_DETAIL,
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
            tenantEditable: EVERY_CONTACT_DETAIL,
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
        // @requirement SC-SUB-047 — A tenant changes the contact details left to it, and never clears them
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
        ['addressLine1', 'Ringstraße 1\f'],
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

    for (const [field, value] of [
        ['legalName', 'Meier & Söhne GmbH'],
        ['vatId', 'DE999999999'],
        ['taxNumber', '12/345/67890'],
    ]) {
        // @requirement SC-SUB-017 — A subscriber's legal identity can be corrected, not replaced, under a running contract
        // @requirement SC-SUB-047 — A tenant changes the contact details left to it, and never clears them
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
async function billingAreaDeciding(subscriber, options) {
    const catalog = { ...paymentsCatalog(), ...TAX_SETTINGS };
    // With an adapter the rate is the adapter's, and the file names none.
    delete catalog.vatRate;
    const ctx = await paymentsApp({
        catalog,
        taxAdapter: { adapterName: 'test-tax', create: () => TEST_TAX_ADAPTER },
        ...options,
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

    // @requirement SC-SUB-047 — A tenant changes the contact details left to it, and never clears them
    test('an empty field of the address is named though the application keeps the address elsewhere', async () => {
        const { details } = await billingAreaDeciding({ postalCode: null }, EMAIL_ONLY);
        const shown = (await details.current(sessionOf('tenant-meier'))).details;
        assert.deepEqual(shown.readiness, {
            ready: false,
            missing: ['postalCode'],
            taxRefusal: null,
        });
        assert.deepEqual(shown.tenantEditable, ['invoiceEmail']);
    });
});

const refusedAsKeptElsewhere = (field) => (error) =>
    codeOf(error) === 'SUBSCRIBER_DETAIL_CHANGED_ELSEWHERE' &&
    paramsOf(error).field === field &&
    error.getStatus() === 422;

// @requirement SC-SUB-047 — A tenant changes the contact details left to it, and never clears them
describe('an application decides which details its tenant changes in the billing area', () => {
    test('the tenant is told which details it changes here: every one where the application names none', async () => {
        for (const [options, editable] of [
            [undefined, EVERY_CONTACT_DETAIL],
            [{ billingDetails: {} }, EVERY_CONTACT_DETAIL],
            [EMAIL_ONLY, ['invoiceEmail']],
            [{ billingDetails: { tenantEditable: [] } }, []],
        ]) {
            const { details } = await billingArea(options);
            const read = await details.current(sessionOf('tenant-meier'));
            const changed = await details.change(sessionOf('tenant-meier'), {});
            assert.deepEqual(
                [read.details.tenantEditable, changed.details.tenantEditable],
                [editable, editable],
                JSON.stringify(options),
            );
        }
    });

    test('the details it names are answered once each, in the order every screen names them', async () => {
        const { details } = await billingArea({
            billingDetails: { tenantEditable: ['invoiceEmail', 'city', 'invoiceEmail'] },
        });
        const read = await details.current(sessionOf('tenant-meier'));
        assert.deepEqual(read.details.tenantEditable, ['city', 'invoiceEmail']);
    });

    test('a detail it names is changed, and the others are kept', async () => {
        const { details } = await billingArea(EMAIL_ONLY);
        const changed = await details.change(sessionOf('tenant-meier'), {
            invoiceEmail: 'kanzlei@steuer.example',
        });
        const shown = Object.fromEntries(
            Object.keys(MEIER).map((field) => [field, changed.details[field]]),
        );
        assert.deepEqual(shown, { ...MEIER, invoiceEmail: 'kanzlei@steuer.example' });
    });

    for (const [label, change] of [
        ['alone', { city: 'Köln' }],
        [
            'beside the invoice email it may change',
            { invoiceEmail: 'neu@meier.example', city: 'Köln' },
        ],
    ]) {
        test(`a detail kept elsewhere, ${label}, is refused by name and nothing of the change is written`, async () => {
            const { details } = await billingArea(EMAIL_ONLY);
            const before = await details.current(sessionOf('tenant-meier'));

            await assert.rejects(
                details.change(sessionOf('tenant-meier'), change),
                refusedAsKeptElsewhere('city'),
            );

            assert.deepEqual(await details.current(sessionOf('tenant-meier')), before);
        });
    }

    for (const [label, field, value] of [
        ['its unchanged value', 'city', MEIER.city],
        ['a clearing null', 'country', null],
        ['a value out of its form', 'country', 'D1'],
        ['the second address line', 'addressLine2', 'Vorderhaus'],
    ]) {
        test(`a detail kept elsewhere is refused by its name, not its value: ${label}`, async () => {
            const { details } = await billingArea(EMAIL_ONLY);
            await assert.rejects(
                details.change(sessionOf('tenant-meier'), { [field]: value }),
                refusedAsKeptElsewhere(field),
            );
        });
    }

    test('a refused country records no change of the tax origin', async () => {
        const { details, subscribers, meier } = await billingArea(EMAIL_ONLY);
        await assert.rejects(
            details.change(sessionOf('tenant-meier'), { country: 'AT' }),
            refusedAsKeptElsewhere('country'),
        );
        assert.deepEqual(await subscribers.listTaxOriginChanges(meier.id), []);
    });

    test('a legal name sent beside a detail kept elsewhere is refused as the legal identity', async () => {
        const { details } = await billingArea(EMAIL_ONLY);
        await assert.rejects(
            details.change(sessionOf('tenant-meier'), { legalName: 'Meier AG', city: 'Köln' }),
            (error) =>
                codeOf(error) === 'SUBSCRIBER_IDENTITY_NOT_A_CONTACT' &&
                paramsOf(error).field === 'legalName',
        );
    });

    test('the invoice email it may change is still not cleared', async () => {
        const { details } = await billingArea(EMAIL_ONLY);
        await assert.rejects(
            details.change(sessionOf('tenant-meier'), { invoiceEmail: null }),
            (error) =>
                codeOf(error) === 'SUBSCRIBER_DETAIL_INVALID' &&
                paramsOf(error).field === 'invoiceEmail',
        );
    });

    test('where it names none, the tenant changes none', async () => {
        const { details } = await billingArea({ billingDetails: { tenantEditable: [] } });
        await assert.rejects(
            details.change(sessionOf('tenant-meier'), { invoiceEmail: 'neu@meier.example' }),
            refusedAsKeptElsewhere('invoiceEmail'),
        );
    });

    test("the application's own page changes what the billing area refuses", async () => {
        const { details, subscribers } = await billingArea(EMAIL_ONLY);

        await subscribers.changeContactOfTenant(
            'tenant-meier',
            { city: 'Köln' },
            'web:owner@meier.example:company-page',
        );
        await assert.rejects(
            details.change(sessionOf('tenant-meier'), { city: 'Bonn' }),
            refusedAsKeptElsewhere('city'),
        );

        assert.equal((await details.current(sessionOf('tenant-meier'))).details.city, 'Köln');
    });
});

/** Meier's billing area over HTTP, behind the strictest global pipe an application installs. */
async function billingAreaOverHttp(options) {
    const { base, subscribers } = await paymentsOverHttp(options);
    await subscribers.createForTenant('tenant-meier', MEIER);
    const route = `${base}/billing/details`;
    const headers = { 'content-type': 'application/json', [TENANT_HEADER]: 'tenant-meier' };
    return {
        change: async (body) => {
            const response = await fetch(route, {
                method: 'PATCH',
                headers,
                body: JSON.stringify(body),
            });
            return { status: response.status, body: await response.json() };
        },
        current: async () => (await (await fetch(route, { headers })).json()).details,
    };
}

/** Values out of their form, each wrong in another way. */
const OUT_OF_FORM = [
    ['country', 'Germany', 'a name instead of a code'],
    ['city', 123, 'a number'],
    ['addressLine1', 'x'.repeat(201), 'a character over its bound'],
];

const refusal = (code, field) => ({ status: 422, code, field });
const refusalOf = ({ status, body }) => ({ status, code: body.code, field: body.params?.field });

// @requirement SC-SUB-047 — A tenant changes the contact details left to it, and never clears them
// @requirement SC-SUB-049 — A line of the address holds one bound, wherever it arrives
describe("the billing details through the application's ValidationPipe", () => {
    for (const [field, value, why] of OUT_OF_FORM) {
        test(`the ${field} kept elsewhere is refused by its name, though its value is ${why}`, async () => {
            const { change, current } = await billingAreaOverHttp(EMAIL_ONLY);
            const before = await current();

            const answer = await change({ [field]: value });

            assert.deepEqual(
                refusalOf(answer),
                refusal('SUBSCRIBER_DETAIL_CHANGED_ELSEWHERE', field),
            );
            assert.deepEqual(await current(), before);
        });

        test(`the ${field} the tenant changes is refused by its name for ${why}`, async () => {
            const { change, current } = await billingAreaOverHttp();
            const before = await current();

            const answer = await change({ [field]: value });

            assert.deepEqual(refusalOf(answer), refusal('SUBSCRIBER_DETAIL_INVALID', field));
            assert.deepEqual(await current(), before);
        });
    }

    test('a detail the tenant changes is written through the pipe', async () => {
        const { change } = await billingAreaOverHttp(EMAIL_ONLY);

        const answer = await change({ invoiceEmail: ' neu@meier.example ' });

        assert.deepEqual(
            [answer.status, answer.body.details.invoiceEmail],
            [200, 'neu@meier.example'],
        );
    });

    test('a field no change has is still refused by the pipe, and nothing is written', async () => {
        const { change, current } = await billingAreaOverHttp(EMAIL_ONLY);
        const before = await current();

        const answer = await change({ invoiceEmail: 'neu@meier.example', nickname: 'Meier' });

        assert.equal(answer.status, 400);
        assert.deepEqual(await current(), before);
    });

    test('the legal identity is refused first, before a detail kept elsewhere', async () => {
        const { change } = await billingAreaOverHttp(EMAIL_ONLY);

        const answer = await change({ legalName: 'Meier AG', country: 'Germany' });

        assert.deepEqual(
            refusalOf(answer),
            refusal('SUBSCRIBER_IDENTITY_NOT_A_CONTACT', 'legalName'),
        );
    });
});

// @requirement SC-SUB-047 — A tenant changes the contact details left to it, and never clears them
describe('the details an application names are held to at the start', () => {
    for (const [named, sentence] of [
        ['street', /names `street`, which is not a contact detail\. It names only addressLine1, /],
        [
            'legalName',
            /names `legalName`: the legal name and the tax identifiers .* \(SC-SUB-017\)/,
        ],
        ['vatId', /names `vatId`: the legal name and the tax identifiers/],
        ['taxNumber', /names `taxNumber`: the legal name and the tax identifiers/],
    ]) {
        test(`${named} stops the start, saying why`, async () => {
            await assert.rejects(
                paymentsApp({ billingDetails: { tenantEditable: ['invoiceEmail', named] } }),
                sentence,
            );
        });
    }

    test('a single name instead of a list stops the start', async () => {
        await assert.rejects(
            paymentsApp({ billingDetails: { tenantEditable: 'invoiceEmail' } }),
            /`tenantBilling.billingDetails.tenantEditable` is a list of contact details/,
        );
    });

    test('named under tenantBilling, it reaches the routes that serve the billing details', () => {
        const payments = { gateways: { [MAIN_ACCOUNT]: new ScriptedGateway() } };
        const editableOf = (dyn) =>
            modulesMounting(dyn, TenantBillingDetailsController)[0].providers.find(
                (provider) =>
                    provider?.provide === Symbol.for('saasicat/nest/TenantEditableDetails'),
            )?.useValue;

        assert.deepEqual(editableOf(composedPlatform({ tenantBilling: EMAIL_ONLY, payments })), [
            'invoiceEmail',
        ]);
        assert.deepEqual(editableOf(composedPlatform({ payments })), EVERY_CONTACT_DETAIL);
        assert.throws(
            () =>
                composedPlatform({
                    tenantBilling: { billingDetails: { tenantEditable: ['street'] } },
                    payments,
                }),
            /names `street`, which is not a contact detail/,
        );
    });
});

// @requirement SC-UI-025 — A tenant finds its billing in one section an application mounts where it keeps billing
// @requirement SC-SUB-047 — A tenant changes the contact details left to it, and never clears them
describe('the billing details where no payment gateway is wired', () => {
    test('are mounted once, with a gateway and without one', () => {
        const payments = { gateways: { [MAIN_ACCOUNT]: new ScriptedGateway() } };
        assert.equal(mountsOf(composedPlatform(), TenantBillingDetailsController), 1);
        assert.equal(mountsOf(composedPlatform({ payments }), TenantBillingDetailsController), 1);
        assert.equal(
            mountsOf(composedPlatform({ tenantBilling: null }), TenantBillingDetailsController),
            0,
            'mounted without tenant billing, the routes would have no tenant guards',
        );
    });

    test('the tenant reads them and changes what the application lets it change', async () => {
        const { details, subscribers } = await billingDetailsWithoutPayments({
            tenantBilling: EMAIL_ONLY,
        });
        await subscribers.createForTenant('tenant-meier', MEIER);

        const read = await details.current(sessionOf('tenant-meier'));
        assert.equal(read.details.legalName, MEIER.legalName);
        assert.deepEqual(read.details.tenantEditable, ['invoiceEmail']);

        const changed = await details.change(sessionOf('tenant-meier'), {
            invoiceEmail: 'kanzlei@steuer.example',
        });
        assert.equal(changed.details.invoiceEmail, 'kanzlei@steuer.example');
        await assert.rejects(
            details.change(sessionOf('tenant-meier'), { city: 'Köln' }),
            refusedAsKeptElsewhere('city'),
        );
    });

    test('a name that is not a contact detail stops the start there too', () => {
        assert.throws(
            () =>
                composedPlatform({
                    tenantBilling: { billingDetails: { tenantEditable: ['street'] } },
                }),
            /names `street`, which is not a contact detail/,
        );
    });
});
