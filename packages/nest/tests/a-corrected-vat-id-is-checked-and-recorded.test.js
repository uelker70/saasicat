// A VAT number given to a subscriber by a correction is checked with the
// service the tax adapter names, right after the correction holds it, and the
// check is recorded whatever it found; the operator can check the number held
// again at any time. A check that does not complete records nothing and leaves
// the number as validated as it was — never validated on a number not checked.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { TaxTreatments } from '../dist/billing/index.js';
import { SubscriberService } from '../dist/subscriber/index.js';
import { FakeSubscriberRepository } from '../dist/testing/index.js';
import { TAX_SETTINGS, TEST_TAX_ADAPTER } from './helpers/tax-adapter.js';

const SETTINGS = { ...TAX_SETTINGS, app: { name: 'Test App' } };
const ADDRESS = { addressLine1: 'Ringstraße 1', postalCode: '1010', city: 'Wien', country: 'AT' };
const PERIOD = {
    from: new Date('2026-10-06T00:00:00.000Z'),
    until: new Date('2026-11-06T00:00:00.000Z'),
};

/** What the VAT number service answers: valid, invalid, or no answer at all. */
const answers = {
    valid: (vatId) => ({
        completed: true,
        check: {
            vatId,
            checkedAt: new Date(),
            valid: true,
            service: 'VIES',
            confirmation: { requestIdentifier: 'R-1' },
        },
    }),
    invalid: (vatId) => ({
        completed: true,
        check: { vatId, checkedAt: new Date(), valid: false, service: 'VIES', confirmation: {} },
    }),
    unreachable: () => ({ completed: false, reason: 'VIES timed out after 10 s.' }),
};

/** An Austrian business of tenant-1, in an installation whose adapter answers checks as `answer` does. */
async function aBusinessInAustria({ answer = answers.valid, adapter = true, vatId = null } = {}) {
    const asked = [];
    const bound = {
        ...TEST_TAX_ADAPTER,
        checkVatId: async (number) => {
            asked.push(number);
            return answer(number);
        },
    };
    const repo = new FakeSubscriberRepository();
    const settings = adapter ? SETTINGS : { vatRate: 19, app: { name: 'Test App' } };
    const subscribers = new SubscriberService(
        repo,
        settings,
        new TaxTreatments(settings, adapter ? bound : null),
    );
    const created = await subscribers.createForTenant('tenant-1', {
        legalName: 'Wien Handel GmbH',
        ...ADDRESS,
        business: true,
        vatId,
    });
    return { subscribers, repo, asked, id: created.id };
}

const correcting = (fields) => ({
    kind: 'correction',
    reason: 'VAT id handed in by the customer',
    correctedBy: 'operator:anna',
    ...fields,
});

const refusedWith = (status, code) => (error) =>
    error.getStatus() === status && error.getResponse().code === code;

/** Whether the subscriber's number counts as validated, as the tax adapter reads it. */
const validated = async (subscribers) =>
    (await subscribers.taxOriginFor({ tenantId: 'tenant-1' })).validatedVatId;

// @requirement SC-PRIC-071 — A VAT number the operator corrects or checks is checked, and every outcome kept
describe('a correction that gives the subscriber another VAT number', () => {
    test('has the number checked once it holds it: a valid answer counts, and the next contract may follow', async () => {
        const { subscribers, repo, asked, id } = await aBusinessInAustria();

        const { correction, vatIdCheck } = await subscribers.correctIdentity(
            id,
            correcting({ vatId: 'atu 123 456 78' }),
        );

        assert.deepEqual(correction.corrected, { vatId: 'ATU12345678' });
        assert.deepEqual(asked, ['ATU12345678'], 'the number is checked as it is held');
        assert.deepEqual(
            [vatIdCheck.completed, vatIdCheck.check.valid, vatIdCheck.counts],
            [true, true, true],
        );
        assert.equal((await repo.listVatIdChecks(id)).length, 1);
        assert.equal(await validated(subscribers), 'ATU12345678');
        assert.equal(
            (await subscribers.readinessFor({ tenantId: 'tenant-1' }, PERIOD.from)).ready,
            true,
        );
    });

    test('keeps the correction where the number is found invalid: the check is recorded, and nothing is validated', async () => {
        const { subscribers, repo, id } = await aBusinessInAustria({ answer: answers.invalid });

        const { vatIdCheck } = await subscribers.correctIdentity(
            id,
            correcting({ vatId: 'ATU99999999' }),
        );

        assert.equal((await subscribers.getById(id)).vatId, 'ATU99999999');
        assert.deepEqual([vatIdCheck.completed, vatIdCheck.check.valid], [true, false]);
        assert.equal((await repo.listVatIdChecks(id)).length, 1, 'an invalid answer is kept too');
        assert.equal(await validated(subscribers), null);
        assert.equal(
            (await subscribers.readinessFor({ tenantId: 'tenant-1' }, PERIOD.from)).taxRefusal,
            'No validated VAT number.',
        );
    });

    test('keeps the correction where the check does not complete: nothing is recorded, and why is said', async () => {
        const { subscribers, repo, id } = await aBusinessInAustria({ answer: answers.unreachable });

        const { vatIdCheck } = await subscribers.correctIdentity(
            id,
            correcting({ vatId: 'ATU12345678' }),
        );

        assert.equal((await subscribers.getById(id)).vatId, 'ATU12345678');
        assert.deepEqual(vatIdCheck, { completed: false, reason: 'VIES timed out after 10 s.' });
        assert.deepEqual(await repo.listVatIdChecks(id), []);
        assert.equal(await validated(subscribers), null);
    });

    test('a valid check of the number replaced does not count for the new one', async () => {
        let answer = answers.valid;
        const { subscribers, id } = await aBusinessInAustria({
            vatId: 'ATU11111111',
            answer: (number) => answer(number),
        });
        await subscribers.checkVatIdOf({ tenantId: 'tenant-1' });
        assert.equal(await validated(subscribers), 'ATU11111111');
        answer = answers.unreachable;

        await subscribers.correctIdentity(id, correcting({ vatId: 'ATU22222222' }));

        assert.equal(await validated(subscribers), null, 'the old number validated the new one');
    });
});

// @requirement SC-PRIC-071 — A VAT number the operator corrects or checks is checked, and every outcome kept
describe('a correction that checks nothing', () => {
    for (const [what, fields] of [
        ['of the legal name alone', { legalName: 'Wien Handel GesmbH' }],
        ['that clears the number', { vatId: null }],
    ]) {
        test(`${what}: the service is not asked`, async () => {
            const { subscribers, asked, id } = await aBusinessInAustria({ vatId: 'ATU12345678' });

            const { vatIdCheck } = await subscribers.correctIdentity(id, correcting(fields));

            assert.equal(vatIdCheck, null);
            assert.deepEqual(asked, []);
        });
    }

    test('where no tax adapter decides: the number is corrected, and nothing is checked', async () => {
        const { subscribers, asked, id } = await aBusinessInAustria({ adapter: false });

        const { vatIdCheck } = await subscribers.correctIdentity(
            id,
            correcting({ vatId: 'ATU12345678' }),
        );

        assert.equal(vatIdCheck, null);
        assert.deepEqual(asked, []);
        assert.equal((await subscribers.getById(id)).vatId, 'ATU12345678');
    });
});

// @requirement SC-PRIC-071 — A VAT number the operator corrects or checks is checked, and every outcome kept
describe('checking the number held, again', () => {
    test('records a valid answer, which then counts', async () => {
        const { subscribers, asked } = await aBusinessInAustria({ vatId: 'ATU12345678' });

        const result = await subscribers.checkVatIdOf({ tenantId: 'tenant-1' });

        assert.deepEqual(asked, ['ATU12345678']);
        assert.deepEqual([result.completed, result.check.valid, result.counts], [true, true, true]);
        assert.equal(await validated(subscribers), 'ATU12345678');
    });

    test('records an invalid answer, which a later valid one replaces', async () => {
        let answer = answers.invalid;
        const { subscribers, repo, id } = await aBusinessInAustria({
            vatId: 'ATU12345678',
            answer: (number) => answer(number),
        });

        await subscribers.checkVatIdOf({ tenantId: 'tenant-1' });
        assert.equal(await validated(subscribers), null);
        answer = answers.valid;
        await subscribers.checkVatIdOf({ subscriberId: id });

        assert.equal(await validated(subscribers), 'ATU12345678');
        assert.equal((await repo.listVatIdChecks(id)).length, 2, 'both answers are kept');
    });

    test('kept, and not counting, where the number was corrected while the service answered', async () => {
        let corrected = false;
        const { subscribers, repo, id } = await aBusinessInAustria({
            vatId: 'ATU12345678',
            answer: async (number) => {
                if (!corrected) {
                    corrected = true;
                    await subscribers.correctIdentity(id, correcting({ vatId: 'ATU87654321' }));
                }
                return answers.valid(number);
            },
        });

        const result = await subscribers.checkVatIdOf({ tenantId: 'tenant-1' });

        assert.deepEqual(
            [result.completed, result.check.vatId, result.check.valid, result.counts],
            [true, 'ATU12345678', true, false],
        );
        assert.equal(await validated(subscribers), 'ATU87654321', 'the number held now');
        assert.equal((await repo.listVatIdChecks(id)).length, 2, 'both answers are kept');
    });

    test('says why where it does not complete, and leaves an earlier valid check counting', async () => {
        let answer = answers.valid;
        const { subscribers, repo, id } = await aBusinessInAustria({
            vatId: 'ATU12345678',
            answer: (number) => answer(number),
        });
        await subscribers.checkVatIdOf({ tenantId: 'tenant-1' });
        answer = answers.unreachable;

        const result = await subscribers.checkVatIdOf({ tenantId: 'tenant-1' });

        assert.deepEqual(result, { completed: false, reason: 'VIES timed out after 10 s.' });
        assert.equal((await repo.listVatIdChecks(id)).length, 1);
        assert.equal(await validated(subscribers), 'ATU12345678');
    });

    test('is refused for a subscriber without a number, and the service is not asked', async () => {
        const { subscribers, asked } = await aBusinessInAustria();

        await assert.rejects(
            subscribers.checkVatIdOf({ tenantId: 'tenant-1' }),
            refusedWith(422, 'SUBSCRIBER_VAT_ID_MISSING'),
        );
        assert.deepEqual(asked, []);
    });

    test('is refused where no tax adapter names a service to check with', async () => {
        const { subscribers } = await aBusinessInAustria({ adapter: false, vatId: 'ATU12345678' });

        await assert.rejects(
            subscribers.checkVatIdOf({ tenantId: 'tenant-1' }),
            refusedWith(409, 'TAX_VAT_ID_CHECK_NOT_AVAILABLE'),
        );
    });

    test('is refused for a tenant without a subscriber', async () => {
        const { subscribers } = await aBusinessInAustria({ vatId: 'ATU12345678' });

        await assert.rejects(
            subscribers.checkVatIdOf({ tenantId: 'tenant-without' }),
            refusedWith(409, 'SUBSCRIBER_REQUIRED'),
        );
    });
});
