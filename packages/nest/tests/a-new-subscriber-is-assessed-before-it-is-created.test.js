// An application that creates a subscriber itself asks first, before the
// transaction that creates it: `SubscriberService.assessNewSubscriber` lets
// the tax adapter decide from the details as given, checks a VAT number only
// where a treatment depends on it, and answers the details with the check
// attached, which `createForTenant` then records. A check of another number
// is refused before anything is written.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { TaxTreatments } from '../dist/billing/index.js';
import { SubscriberService } from '../dist/subscriber/index.js';
import { FakeSubscriberRepository } from '../dist/testing/index.js';
import { TAX_SETTINGS, TEST_TAX_ADAPTER } from './helpers/tax-adapter.js';

const A_MONTH = {
    from: new Date('2026-10-05T00:00:00.000Z'),
    until: new Date('2026-11-05T00:00:00.000Z'),
};

const checked = (vatId, valid = true) => ({
    vatId,
    checkedAt: new Date('2026-10-05T08:00:00.000Z'),
    valid,
    service: 'VIES',
    confirmation: { requestIdentifier: 'R-1' },
});

/** The subscribers of an installation whose adapter checks numbers as `answer` says. */
function subscribersWith({
    answer = (vatId) => ({ completed: true, check: checked(vatId) }),
    adapter,
} = {}) {
    const asked = [];
    const bound = adapter ?? {
        ...TEST_TAX_ADAPTER,
        checkVatId: async (vatId) => {
            asked.push(vatId);
            return answer(vatId);
        },
    };
    const repo = new FakeSubscriberRepository();
    const settings = { ...TAX_SETTINGS, app: { name: 'Test App' } };
    return {
        asked,
        repo,
        subscribers: new SubscriberService(repo, settings, new TaxTreatments(settings, bound)),
    };
}

const refusedWith = (status, code) => (error) =>
    error.getStatus() === status && error.getResponse().code === code;

// @requirement SC-PRIC-068 — A new subscriber is asked about before it exists
describe('an application asks before it creates a subscriber', () => {
    test('a subscriber in Germany is treated as given: no number is checked', async () => {
        const { subscribers, asked } = subscribersWith();
        const assessed = await subscribers.assessNewSubscriber(
            { legalName: 'Meier GmbH', country: 'DE', vatId: 'DE123456789', business: true },
            A_MONTH,
        );
        assert.deepEqual(asked, []);
        assert.equal(assessed.vatIdCheck, null);
    });

    test('a business in Austria: its number checked as it will be held, and the check attached', async () => {
        const { subscribers, asked } = subscribersWith();
        const assessed = await subscribers.assessNewSubscriber(
            { legalName: 'Wien GmbH', country: 'AT', vatId: ' atu 123 456 78', business: true },
            A_MONTH,
        );
        assert.deepEqual(asked, ['ATU12345678']);
        assert.deepEqual(
            [assessed.vatIdCheck.vatId, assessed.vatIdCheck.valid],
            ['ATU12345678', true],
        );
        assert.equal(assessed.legalName, 'Wien GmbH', 'the details are answered as given');
    });

    test('a consumer outside Germany with a number: checked, and still refused with the adapter sentence', async () => {
        const { subscribers, asked } = subscribersWith();
        await assert.rejects(
            subscribers.assessNewSubscriber(
                { legalName: 'Dupont', country: 'FR', vatId: 'FR12345678901', business: false },
                A_MONTH,
            ),
            refusedWith(422, 'TAX_TREATMENT_NOT_SUPPORTED'),
        );
        assert.deepEqual(asked, ['FR12345678901']);
    });

    test('a check that does not complete is a 503 naming the adapter and why, never a validation', async () => {
        const { subscribers } = subscribersWith({
            answer: () => ({ completed: false, reason: 'VIES timed out after 10 s.' }),
        });
        await assert.rejects(
            subscribers.assessNewSubscriber(
                { legalName: 'Wien GmbH', country: 'AT', vatId: 'ATU12345678', business: true },
                A_MONTH,
            ),
            (error) =>
                refusedWith(503, 'TAX_VAT_ID_CHECK_NOT_COMPLETED')(error) &&
                error.getResponse().params.adapter === 'test-tax' &&
                error.getResponse().params.reason === 'VIES timed out after 10 s.',
        );
    });

    test('an adapter that fails is not taken for a refusal: its error comes through', async () => {
        const { subscribers } = subscribersWith({
            adapter: {
                ...TEST_TAX_ADAPTER,
                decide: () => {
                    throw new Error('the rate table could not be read');
                },
            },
        });
        await assert.rejects(
            subscribers.assessNewSubscriber(
                { legalName: 'Wien GmbH', country: 'AT', vatId: 'ATU12345678', business: true },
                A_MONTH,
            ),
            /the rate table could not be read/,
        );
    });

    test('without an adapter the details come back as they are, nothing checked', async () => {
        const repo = new FakeSubscriberRepository();
        const subscribers = new SubscriberService(repo, { vatRate: 19, app: { name: 'Test App' } });
        const assessed = await subscribers.assessNewSubscriber(
            { legalName: 'Wien GmbH', country: 'AT', vatId: 'ATU12345678', business: true },
            A_MONTH,
        );
        assert.equal(assessed.vatIdCheck, null);
    });
});

// @requirement SC-PRIC-068 — A new subscriber is asked about before it exists
describe('a subscriber created with a check keeps it', () => {
    test('the attached check is recorded, and the number counts as validated', async () => {
        const { subscribers, repo } = subscribersWith();
        const assessed = await subscribers.assessNewSubscriber(
            { legalName: 'Wien GmbH', country: 'AT', vatId: 'ATU12345678', business: true },
            A_MONTH,
        );

        const created = await subscribers.createForTenant('tenant-1', assessed, { id: 'tx-1' });

        const counting = await repo.findCurrentVatIdCheck(created.id);
        assert.deepEqual([counting.vatId, counting.valid], ['ATU12345678', true]);
        const origin = await subscribers.taxOriginFor({ tenantId: 'tenant-1' });
        assert.equal(origin.validatedVatId, 'ATU12345678');
    });

    test('a check is recorded only on the transaction the subscriber is created on', async () => {
        const { subscribers, repo } = subscribersWith();
        const assessed = await subscribers.assessNewSubscriber(
            { legalName: 'Wien GmbH', country: 'AT', vatId: 'ATU12345678', business: true },
            A_MONTH,
        );

        await assert.rejects(
            subscribers.createForTenant('tenant-1', assessed),
            /on one transaction: pass the transaction the tenant is created on/,
        );
        assert.equal(await repo.findByTenantId('tenant-1'), null, 'nothing was written');
    });

    test('assessed details need the transaction even where no check was needed', async () => {
        const { subscribers, repo } = subscribersWith();
        const assessed = await subscribers.assessNewSubscriber(
            { legalName: 'Meier GmbH', country: 'DE', business: false },
            A_MONTH,
        );
        assert.equal(assessed.vatIdCheck, null);

        await assert.rejects(
            subscribers.createForTenant('tenant-1', assessed),
            /on one transaction: pass the transaction the tenant is created on/,
        );
        assert.equal(await repo.findByTenantId('tenant-1'), null, 'nothing was written');
    });

    test('a check of another number is refused before anything is written', async () => {
        const { subscribers, repo } = subscribersWith();
        await assert.rejects(
            subscribers.createForTenant('tenant-1', {
                legalName: 'Wien GmbH',
                country: 'AT',
                vatId: 'ATU12345678',
                vatIdCheck: checked('ATU99999999'),
            }),
            (error) =>
                refusedWith(422, 'SUBSCRIBER_DETAIL_INVALID')(error) &&
                error.getResponse().params.field === 'vatIdCheck',
        );
        assert.equal(await repo.findByTenantId('tenant-1'), null);
    });

    test('created without a check, no number counts as validated', async () => {
        const { subscribers, repo } = subscribersWith();
        const created = await subscribers.createForTenant('tenant-1', {
            legalName: 'Wien GmbH',
            country: 'AT',
            vatId: 'ATU12345678',
        });
        assert.equal(await repo.findCurrentVatIdCheck(created.id), null);
    });
});
