// How long a line of a subscriber's address may be is one answer, whichever
// way the detail arrives — a subscriber an application creates, a change of
// its contact details, sign-up's form, the operator's correction of an
// invoice — and whether or not the application installs a `ValidationPipe`:
// the platform settles it itself, and a route that declares a bound declares
// the same one.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import {
    INVOICE_CORRECTION_MAX_LENGTH,
    INVOICE_SUBSCRIBER_DETAILS,
    invoiceCorrectionMaxLengthOf,
    SUBSCRIBER_ADDRESS_MAX_LENGTHS,
} from '@saasicat/core';

import { InvoiceSubscriberCorrectionsDto } from '../dist/billing/index.js';
import { RegistrationBillingDetailsDto } from '../dist/registration/index.js';
import { subscribersFor } from './helpers/subscribers.js';

/** The bounds `SC-SUB-049` promises, written out: a change of them is a change of the promise. */
const PROMISED = { addressLine1: 200, addressLine2: 200, postalCode: 20, city: 100 };

const refusedAs = (field) => (error) => {
    assert.deepEqual(
        [error.getStatus(), error.getResponse().code, error.getResponse().params],
        [422, 'SUBSCRIBER_DETAIL_INVALID', { field }],
    );
    return true;
};

/** A complete sign-up address, which `field` then replaces. */
const SIGN_UP = {
    addressLine1: 'Hauptstraße 1',
    postalCode: '10115',
    city: 'Berlin',
    country: 'DE',
};

/** What the application's `ValidationPipe` says of `body`: `null` where it passes. */
async function pipeRefusalOf(metatype, body) {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true });
    return pipe.transform(body, { type: 'body', metatype }).then(
        () => null,
        (error) => error.getStatus(),
    );
}

// @requirement SC-SUB-049 — A line of the address holds one bound, wherever it arrives
describe('a line of the address holds one bound', () => {
    test('the bounds are the ones promised', () => {
        assert.deepEqual({ ...SUBSCRIBER_ADDRESS_MAX_LENGTHS }, PROMISED);
    });

    test("the operator's correction holds a line of the address to its bound, and the rest to its own", () => {
        assert.deepEqual(
            INVOICE_SUBSCRIBER_DETAILS.map((detail) => [
                detail,
                invoiceCorrectionMaxLengthOf(detail),
            ]),
            INVOICE_SUBSCRIBER_DETAILS.map((detail) => [
                detail,
                PROMISED[detail] ?? INVOICE_CORRECTION_MAX_LENGTH,
            ]),
        );
    });

    for (const [field, bound] of Object.entries(PROMISED)) {
        test(`a subscriber is created with the ${field} at its bound, the blanks around it not counted`, async () => {
            const { service } = await subscribersFor();

            const created = await service.createForTenant('tenant-1', {
                legalName: 'Meier GmbH',
                [field]: `  ${'x'.repeat(bound)} `,
            });

            assert.equal(created[field], 'x'.repeat(bound));
        });

        test(`a subscriber with the ${field} a character over it is refused, naming it`, async () => {
            const { service } = await subscribersFor();

            await assert.rejects(
                service.createForTenant('tenant-1', {
                    legalName: 'Meier GmbH',
                    [field]: 'x'.repeat(bound + 1),
                }),
                refusedAs(field),
            );
        });
    }

    test('a change of the contact details is held to it with no pipe at all, and nothing is written', async () => {
        const { service } = await subscribersFor(['tenant-1']);
        const subscriber = await service.requireForTenant('tenant-1');

        await assert.rejects(
            service.changeContact(
                subscriber.id,
                { postalCode: '28195', city: 'x'.repeat(PROMISED.city + 1) },
                'operator:anna',
            ),
            refusedAs('city'),
        );

        const kept = await service.getById(subscriber.id);
        assert.deepEqual([kept.postalCode, kept.city], [null, null]);
    });

    for (const [why, metatype, around] of [
        ["sign-up's form", RegistrationBillingDetailsDto, SIGN_UP],
        ["the operator's correction of an invoice", InvoiceSubscriberCorrectionsDto, {}],
    ]) {
        test(`${why} declares the same bound to the application's pipe`, async () => {
            for (const [field, bound] of Object.entries(PROMISED)) {
                const at = { ...around, [field]: 'x'.repeat(bound) };
                const over = { ...around, [field]: 'x'.repeat(bound + 1) };
                assert.equal(await pipeRefusalOf(metatype, at), null, `${field} at its bound`);
                assert.equal(await pipeRefusalOf(metatype, over), 400, `${field} over it`);
            }
        });
    }
});
