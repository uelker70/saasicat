// How long the legal name and each tax identifier may be, and what form the
// country has, is one answer whichever way the detail arrives — a subscriber
// an application creates, a correction of the legal identity, sign-up's form,
// the operator's correction of an invoice — and whether or not the
// application installs a `ValidationPipe`: the platform settles each itself,
// and no route declares a bound or a form of its own for a pipe to judge
// differently.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import {
    SUBSCRIBER_LEGAL_NAME_MAX_LENGTH,
    SUBSCRIBER_TAX_IDENTIFIER_MAX_LENGTH,
} from '@saasicat/core';

import { InvoiceSubscriberCorrectionsDto } from '../dist/billing/index.js';
import { RegisterStartDto, RegistrationBillingDetailsDto } from '../dist/registration/index.js';
import { subscribersFor } from './helpers/subscribers.js';

/** The bounds `SC-SUB-050` promises, written out: a change of them is a change of the promise. */
const PROMISED = { legalName: 300, vatId: 30, taxNumber: 30 };

const refusedAs = (field) => (error) => {
    assert.deepEqual(
        [error.getStatus(), error.getResponse().code, error.getResponse().params],
        [422, 'SUBSCRIBER_DETAIL_INVALID', { field }],
    );
    return true;
};

/** A detail of `length` characters the platform keeps as written. */
const ofLength = (length) => 'X'.repeat(length);

/** A correction of the legal identity, as the operator gives one. */
const correctionOf = (values) => ({
    kind: 'correction',
    ...values,
    reason: 'Typo in the registered name',
    correctedBy: 'operator:anna',
});

/** What the application's `ValidationPipe` says of `body`: `null` where it passes. */
async function pipeRefusalOf(metatype, body) {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true });
    return pipe.transform(body, { type: 'body', metatype }).then(
        () => null,
        (error) => error.getStatus(),
    );
}

// @requirement SC-SUB-050 — Legal name, tax identifiers and country hold one bound and one form at every way in
describe('each detail of the legal identity holds one bound', () => {
    test('the bounds are the ones promised', () => {
        assert.deepEqual(
            {
                legalName: SUBSCRIBER_LEGAL_NAME_MAX_LENGTH,
                vatId: SUBSCRIBER_TAX_IDENTIFIER_MAX_LENGTH,
                taxNumber: SUBSCRIBER_TAX_IDENTIFIER_MAX_LENGTH,
            },
            PROMISED,
        );
    });

    for (const [field, bound] of Object.entries(PROMISED)) {
        test(`a subscriber is created with the ${field} at its bound, the blanks around it not counted`, async () => {
            const { service } = await subscribersFor();

            const created = await service.createForTenant('tenant-1', {
                legalName: 'Meier GmbH',
                [field]: `  ${ofLength(bound)} `,
            });

            assert.equal(created[field], ofLength(bound));
        });

        test(`a subscriber with the ${field} a character over it is refused, naming it`, async () => {
            const { service } = await subscribersFor();

            await assert.rejects(
                service.createForTenant('tenant-1', {
                    legalName: 'Meier GmbH',
                    [field]: ofLength(bound + 1),
                }),
                refusedAs(field),
            );
        });

        test(`a correction of the legal identity takes the ${field} at its bound and refuses one over it, writing nothing`, async () => {
            const { service } = await subscribersFor(['tenant-1']);
            const subscriber = await service.requireForTenant('tenant-1');

            await assert.rejects(
                service.correctIdentity(
                    subscriber.id,
                    correctionOf({ [field]: ofLength(bound + 1) }),
                ),
                refusedAs(field),
            );
            assert.deepEqual(await service.getById(subscriber.id), subscriber);

            await service.correctIdentity(
                subscriber.id,
                correctionOf({ [field]: ofLength(bound) }),
            );
            assert.equal((await service.getById(subscriber.id))[field], ofLength(bound));
        });
    }

    test('a VAT number is measured as it was written, before its separators are dropped', async () => {
        const { service } = await subscribersFor();
        const written = `DE${' 1'.repeat(14)}`;
        assert.equal(written.length, PROMISED.vatId);

        const created = await service.createForTenant('tenant-1', {
            legalName: 'Meier GmbH',
            vatId: written,
        });
        assert.equal(created.vatId, `DE${'1'.repeat(14)}`);

        await assert.rejects(
            service.createForTenant('tenant-2', { legalName: 'Meier GmbH', vatId: `${written}1` }),
            refusedAs('vatId'),
        );
    });

    test('a country is taken in its form wherever it arrives, upper-cased first', async () => {
        const { service } = await subscribersFor();

        const created = await service.createForTenant('tenant-1', {
            legalName: 'Meier GmbH',
            country: ' de ',
        });

        assert.equal(created.country, 'DE');
    });

    for (const [why, metatype, body] of [
        [
            "sign-up's form, a tax identifier over its bound and a country in lower case",
            RegistrationBillingDetailsDto,
            {
                addressLine1: 'Hauptstraße 1',
                postalCode: '10115',
                city: 'Berlin',
                country: 'de',
                vatId: ofLength(PROMISED.vatId + 1),
                taxNumber: ofLength(PROMISED.taxNumber + 1),
            },
        ],
        [
            "the operator's correction of an invoice, every identity detail over its bound",
            InvoiceSubscriberCorrectionsDto,
            {
                legalName: ofLength(PROMISED.legalName + 1),
                vatId: ofLength(PROMISED.vatId + 1),
                taxNumber: ofLength(PROMISED.taxNumber + 1),
                country: 'de',
            },
        ],
        [
            "sign-up's first step, a tenant name over its bound",
            RegisterStartDto,
            {
                tenantName: ofLength(121),
                firstName: 'Anna',
                lastName: 'Meier',
                email: 'anna@meier.example',
                password: 'Password123',
                termsAccepted: true,
            },
        ],
    ]) {
        test(`${why}, leaves the judgement to the platform: the application's pipe passes it`, async () => {
            assert.equal(await pipeRefusalOf(metatype, body), null);
        });
    }
});
