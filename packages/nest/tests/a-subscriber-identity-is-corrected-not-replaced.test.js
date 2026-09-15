// A subscriber's contact details change freely; its legal identity is corrected.
//
// The address and the invoice email say how a party is reached, and later
// documents read the new ones. The legal name and the tax identifiers say who
// the party is: they change only as a correction of that same legal entity,
// recorded with the values it replaced, the reason and who made it. Another
// legal entity taking over is a transfer, and SaaSiCat cannot tell the two
// apart, so the operator declares which it is — and a takeover is refused
// rather than written as an edit.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { SUBSCRIBER_CATALOG, subscribersFor } from './helpers/subscribers.js';

const refusedWith = (code, params) => (error) => {
    const body = error.getResponse?.() ?? error.response;
    assert.equal(body?.code, code, error.message);
    if (params) assert.deepEqual(body.params, params);
    return true;
};

describe('a new subscriber', () => {
    test('is recorded as given: trimmed, a blank detail unknown, the country in capitals', async () => {
        const { service } = await subscribersFor();

        const subscriber = await service.createForTenant('tenant-1', {
            legalName: '  Meier Autohaus GmbH  ',
            addressLine1: 'Hauptstraße 1 ',
            addressLine2: '   ',
            city: 'Berlin',
            country: 'de',
            vatId: '',
            invoiceEmail: ' rechnung@meier.example ',
        });

        assert.equal(subscriber.legalName, 'Meier Autohaus GmbH');
        assert.equal(subscriber.addressLine1, 'Hauptstraße 1');
        assert.equal(subscriber.addressLine2, null);
        assert.equal(subscriber.postalCode, null, 'a detail left out is unknown');
        assert.equal(subscriber.country, 'DE');
        assert.equal(subscriber.vatId, null);
        assert.equal(subscriber.invoiceEmail, 'rechnung@meier.example');
        assert.equal(subscriber.tenantId, 'tenant-1');
    });

    test('is numbered behind the prefix the configuration names, and without one the number alone', async () => {
        const prefixed = await subscribersFor([], {
            ...SUBSCRIBER_CATALOG,
            subscribers: { customerNumberPrefix: 'K-' },
        });
        const plain = await subscribersFor();

        const withPrefix = await prefixed.service.createForTenant('tenant-1', { legalName: 'A' });
        const withoutPrefix = await plain.service.createForTenant('tenant-1', { legalName: 'B' });

        assert.equal(withPrefix.customerNumber, 'K-10001');
        assert.equal(withoutPrefix.customerNumber, '10001');
    });

    test('is refused for a tenant that already has one', async () => {
        const { service } = await subscribersFor(['tenant-1']);

        await assert.rejects(
            () => service.createForTenant('tenant-1', { legalName: 'Second GmbH' }),
            refusedWith('SUBSCRIBER_ALREADY_EXISTS', { tenantId: 'tenant-1' }),
        );
        assert.equal(
            (await service.requireForTenant('tenant-1')).legalName,
            'Customer of tenant-1',
        );
    });

    for (const [what, legalName] of [
        ['no legal name at all', undefined],
        ['an empty one', ''],
        ['one of spaces', '   '],
    ]) {
        test(`with ${what} is refused`, async () => {
            const { service } = await subscribersFor();

            await assert.rejects(
                () => service.createForTenant('tenant-1', { legalName }),
                refusedWith('SUBSCRIBER_LEGAL_NAME_REQUIRED'),
            );
            assert.equal(await service.findByTenantId('tenant-1'), null);
        });
    }

    for (const [field, value] of [
        ['country', 'Germany'],
        ['country', 'D'],
        ['invoiceEmail', 'anna'],
        ['invoiceEmail', 'anna@meier'],
        ['invoiceEmail', 'anna@@meier.example'],
        ['invoiceEmail', 'anna meier@meier.example'],
        ['invoiceEmail', '@meier.example'],
        ['invoiceEmail', 'anna@meier.'],
        ['legalName', 42],
        ['vatId', { value: 'DE1' }],
    ]) {
        test(`with ${field} ${JSON.stringify(value)} is refused, naming the field`, async () => {
            const { service } = await subscribersFor();

            await assert.rejects(
                () =>
                    service.createForTenant('tenant-1', {
                        legalName: 'Meier GmbH',
                        [field]: value,
                    }),
                refusedWith('SUBSCRIBER_DETAIL_INVALID', { field }),
            );
        });
    }

    test('whose details have their form goes through', async () => {
        // The counter-check to the refusals: a rule that refused every address
        // would pass all of them.
        const { service } = await subscribersFor();

        const subscriber = await service.createForTenant('tenant-1', {
            legalName: 'Meier GmbH',
            country: 'AT',
            invoiceEmail: 'buchhaltung@meier-autohaus.co.at',
        });

        assert.equal(subscriber.country, 'AT');
    });
});

describe('contact details', () => {
    // @requirement SC-SUB-017 — A subscriber's legal identity can be corrected, not replaced, under a running contract
    test('change at any time: what is named is written, null clears, the rest is kept', async () => {
        const { service } = await subscribersFor();
        const created = await service.createForTenant('tenant-1', {
            legalName: 'Meier GmbH',
            addressLine2: 'Hinterhaus',
            city: 'Berlin',
            invoiceEmail: 'alt@meier.example',
        });

        const changed = await service.changeContact(created.id, {
            city: ' Potsdam ',
            addressLine2: null,
            country: 'de',
        });

        assert.equal(changed.city, 'Potsdam');
        assert.equal(changed.addressLine2, null);
        assert.equal(changed.country, 'DE');
        assert.equal(changed.invoiceEmail, 'alt@meier.example', 'a detail left out was cleared');
        assert.equal(changed.legalName, 'Meier GmbH');
    });

    for (const field of ['legalName', 'vatId', 'taxNumber']) {
        // @requirement SC-SUB-017 — A subscriber's legal identity can be corrected, not replaced, under a running contract
        test(`do not include ${field}, which is refused rather than dropped`, async () => {
            const { service } = await subscribersFor(['tenant-1']);
            const subscriber = await service.requireForTenant('tenant-1');

            await assert.rejects(
                () => service.changeContact(subscriber.id, { city: 'Kiel', [field]: 'Other' }),
                refusedWith('SUBSCRIBER_IDENTITY_NOT_A_CONTACT', { field }),
            );
            assert.equal(
                (await service.getById(subscriber.id)).city,
                null,
                'half of it was written',
            );
        });
    }

    test('are refused where they have no form', async () => {
        const { service } = await subscribersFor(['tenant-1']);
        const subscriber = await service.requireForTenant('tenant-1');

        await assert.rejects(
            () => service.changeContact(subscriber.id, { invoiceEmail: 'no address' }),
            refusedWith('SUBSCRIBER_DETAIL_INVALID', { field: 'invoiceEmail' }),
        );
    });

    test('of a subscriber that does not exist are refused as not found', async () => {
        const { service } = await subscribersFor();

        await assert.rejects(
            () => service.changeContact('subscriber-nobody', { city: 'Kiel' }),
            refusedWith('SUBSCRIBER_NOT_FOUND', { subscriberId: 'subscriber-nobody' }),
        );
    });
});

// @requirement SC-SUB-017 — A subscriber's legal identity can be corrected, not replaced, under a running contract
describe('a correction of the legal identity', () => {
    async function subscriber() {
        const built = await subscribersFor();
        const record = await built.service.createForTenant('tenant-1', {
            legalName: 'Mueller GmbH',
            vatId: 'DE111111111',
        });
        return { ...built, record };
    }

    const correction = (overrides) => ({
        kind: 'correction',
        reason: 'Umlaut lost when the registration was typed',
        correctedBy: 'operator:anna',
        ...overrides,
    });

    test('writes the corrected values and records the ones it replaced, why, and by whom', async () => {
        const { service, record } = await subscriber();

        const recorded = await service.correctIdentity(
            record.id,
            correction({ legalName: 'Müller GmbH', vatId: null, taxNumber: '12/345/67890' }),
        );

        assert.deepEqual(recorded.previous, {
            legalName: 'Mueller GmbH',
            vatId: 'DE111111111',
            taxNumber: null,
        });
        assert.deepEqual(recorded.corrected, {
            legalName: 'Müller GmbH',
            vatId: null,
            taxNumber: '12/345/67890',
        });
        assert.equal(recorded.reason, 'Umlaut lost when the registration was typed');
        assert.equal(recorded.correctedBy, 'operator:anna');
        const now = await service.getById(record.id);
        assert.equal(now.legalName, 'Müller GmbH');
        assert.equal(now.vatId, null);
        assert.deepEqual(
            (await service.listCorrections(record.id)).map((entry) => entry.id),
            [recorded.id],
        );
    });

    test('declared as another legal entity taking over is refused, and nothing changes', async () => {
        const { service, record } = await subscriber();

        await assert.rejects(
            () =>
                service.correctIdentity(
                    record.id,
                    correction({ kind: 'takeover', legalName: 'Käufer AG' }),
                ),
            refusedWith('SUBSCRIBER_TAKEOVER_IS_A_TRANSFER'),
        );
        assert.equal((await service.getById(record.id)).legalName, 'Mueller GmbH');
        assert.deepEqual(await service.listCorrections(record.id), []);
    });

    for (const [what, overrides, code] of [
        ['without a reason', { reason: '' }, 'SUBSCRIBER_CORRECTION_REASON_REQUIRED'],
        ['with a reason of spaces', { reason: '  ' }, 'SUBSCRIBER_CORRECTION_REASON_REQUIRED'],
        [
            'without saying who makes it',
            { correctedBy: '' },
            'SUBSCRIBER_CORRECTION_ACTOR_REQUIRED',
        ],
        ['to an empty legal name', { legalName: '  ' }, 'SUBSCRIBER_LEGAL_NAME_REQUIRED'],
        [
            'that changes nothing',
            { legalName: 'Mueller GmbH' },
            'SUBSCRIBER_CORRECTION_CHANGES_NOTHING',
        ],
        ['that names nothing', { legalName: undefined }, 'SUBSCRIBER_CORRECTION_CHANGES_NOTHING'],
    ]) {
        test(`${what} is refused, and nothing is recorded`, async () => {
            const { service, record } = await subscriber();

            await assert.rejects(
                () =>
                    service.correctIdentity(
                        record.id,
                        correction({ legalName: 'Müller GmbH', ...overrides }),
                    ),
                refusedWith(code),
            );
            assert.deepEqual(await service.listCorrections(record.id), []);
            assert.equal((await service.getById(record.id)).legalName, 'Mueller GmbH');
        });
    }

    test('of a subscriber that does not exist is refused as not found', async () => {
        const { service } = await subscriber();

        await assert.rejects(
            () => service.correctIdentity('subscriber-nobody', correction({ legalName: 'X' })),
            refusedWith('SUBSCRIBER_NOT_FOUND'),
        );
    });
});
