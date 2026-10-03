// Retiring an add-on version where the add-on is managed, driven without a
// page: where the action is offered, which version the bookings continue on,
// and what the announcement sends — behind the second factor, with exactly the
// bookings the operator saw.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ref } from 'vue';

import {
    AdminError,
    bundleRetirementOf,
    retirementSkipLines,
    useBundleVersionRetirement,
} from '../dist/index.js';
import { answeringSecondFactor, recordingRetirements } from './support/retirement-flow.mjs';

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetDays) => new Date(NOW + offsetDays * DAY).toISOString();

/** A published version of the add-on SEATS; `fields` say where it stands. */
const version = (fields = {}) => ({
    id: 'bv-1',
    bundleId: 'b-seats',
    bundleKey: 'SEATS',
    label: 'Seats',
    version: 1,
    publishedAt: iso(-400),
    supersededAt: null,
    validFrom: iso(-400),
    validUntil: null,
    endsAt: null,
    ...fields,
});

const OFF_SALE = version({ validUntil: iso(-2) });
const ON_SALE = version({ id: 'bv-2', version: 2, validFrom: iso(-1) });

const SIDE = { bundleKey: 'SEATS', label: 'Seats', features: [], quotas: {}, yearlyNet: 90 };

/** A preview reaching the bookings in `reached`. */
const previewOf = ({ reached = [], blockers = [] } = {}) => ({
    retired: { ...SIDE, bundleVersionId: 'bv-1', version: 1, monthlyNet: 9 },
    replacement: { ...SIDE, bundleVersionId: 'bv-2', version: 2, monthlyNet: 11 },
    changes: [],
    asOf: iso(0),
    reached,
    skipped: [],
    blockers,
});
const reachedBooking = (subscriptionBundleId) => ({
    tenantId: 't',
    subscriptionId: `s-of-${subscriptionBundleId}`,
    subscriptionBundleId,
    planKey: 'STANDARD',
    planCycle: 'MONTHLY',
    billingCycle: 'MONTHLY',
    effectiveAt: '2027-02-01T00:00:00.000Z',
    lastDayToCancel: '2027-01-31',
    reachedRecently: false,
});

/** The add-on page's flow over resources that record what they were asked. */
function drive({
    capability = true,
    versions = [OFF_SALE, ON_SALE],
    preview = previewOf({ reached: [reachedBooking('sb-1'), reachedBooking('sb-2')] }),
    announce = async () => ({ retirement: { id: 'r-1' }, told: 2, failed: 0 }),
    code = '123456',
    list = async () => [],
} = {}) {
    const requests = [];
    const prompts = [];
    const flow = useBundleVersionRetirement({
        versions: ref(versions),
        manifest: ref({ capabilities: capability ? { 'bundleVersions.retire': true } : {} }),
        retirements: recordingRetirements({ requests, list, preview, announce }),
        mfa: answeringSecondFactor({ prompts, code }),
    });
    return { flow, requests, prompts };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

// @requirement SC-BUN-038 — An add-on version is retired only off sale, onto a version of the same add-on on sale
describe('where retiring an add-on version is offered', () => {
    test('on a version no longer on sale, where the platform serves it, and on no other', () => {
        assert.equal(drive().flow.canRetire(OFF_SALE), true);
        assert.equal(drive().flow.canRetire(ON_SALE), false, 'on sale');
        assert.equal(drive().flow.canRetire(version({ publishedAt: null })), false, 'a draft');
        assert.equal(drive().flow.canRetire(version({ validFrom: iso(10) })), false, 'scheduled');
        assert.equal(drive({ capability: false }).flow.canRetire(OFF_SALE), false, 'unserved');
    });
});

describe('the add-on retirement flow', () => {
    test('reads the announcements made where retiring is offered, and none elsewhere', async () => {
        const record = { id: 'r-1', retired: { bundleVersionId: 'bv-1' } };
        const served = drive({ list: async () => [record] });
        const unserved = drive({ capability: false, list: async () => [record] });
        await settled();

        assert.equal(served.flow.retirementOf(OFF_SALE).id, 'r-1');
        assert.equal(served.flow.retirementOf(ON_SALE), null);
        assert.deepEqual(unserved.requests, []);
        assert.equal(unserved.flow.retirementOf(OFF_SALE), null);
    });

    test('the announcement that retired a version is the most recent one, as the server lists them', () => {
        const records = [
            { id: 'r-2', retired: { bundleVersionId: 'bv-1' } },
            { id: 'r-1', retired: { bundleVersionId: 'bv-1' } },
        ];

        assert.equal(bundleRetirementOf(records, 'bv-1').id, 'r-2');
        assert.equal(bundleRetirementOf(records, 'bv-9'), null);
    });

    test('says why the announcements could not be read', async () => {
        const { flow } = drive({
            list: async () => {
                throw new AdminError({ status: 500, detail: 'database down' });
            },
        });
        await settled();

        assert.equal(flow.recordsError.value, 'database down');
    });

    test("opens with the add-on's version on sale as the replacement, and asks for its preview", async () => {
        const { flow, requests } = drive();
        await settled();
        requests.length = 0;

        await flow.open(OFF_SALE);

        assert.equal(flow.target.value.id, 'bv-1');
        assert.equal(flow.replacement.value.id, 'bv-2');
        assert.deepEqual(requests, [['preview', 'bv-1', 'bv-2']]);
        assert.equal(flow.preview.value.reached.length, 2);
    });

    test('an add-on with no version on sale has no replacement and asks for no preview', async () => {
        const { flow, requests } = drive({ versions: [OFF_SALE] });
        await settled();
        requests.length = 0;

        await flow.open(OFF_SALE);

        assert.equal(flow.replacement.value, null);
        assert.equal(flow.preview.value, null);
        assert.deepEqual(requests, []);
    });

    // @requirement SC-BUN-039 — An add-on retirement is announced for exactly the bookings the operator was shown
    test('announces behind the second factor, naming the replacement and the bookings shown', async () => {
        const { flow, requests, prompts } = drive();
        await flow.open(OFF_SALE);

        await flow.announce();

        assert.deepEqual(prompts, ['Retire v1 of SEATS for running bookings.']);
        assert.deepEqual(requests.at(-2), [
            'announce',
            'bv-1',
            { replacementBundleVersionId: 'bv-2', subscriptionBundleIds: ['sb-1', 'sb-2'] },
            '123456',
        ]);
        assert.deepEqual(flow.result.value, { retirement: { id: 'r-1' }, told: 2, failed: 0 });
        assert.deepEqual(requests.at(-1), ['list'], 'and reads the announcements again');
    });

    test('a cancelled code announces nothing', async () => {
        const { flow, requests } = drive({ code: null });
        await flow.open(OFF_SALE);

        await flow.announce();

        assert.equal(
            requests.some(([name]) => name === 'announce'),
            false,
        );
        assert.equal(flow.result.value, null);
    });

    test('a preview with a blocker is not announced at all', async () => {
        const blocked = previewOf({
            reached: [reachedBooking('sb-1')],
            blockers: [
                {
                    code: 'BUNDLE_RETIREMENT_REPLACEMENT_CANNOT_RUN',
                    message: 'm',
                    params: { count: 1, bundleKey: 'SEATS', version: 2 },
                },
            ],
        });
        const { flow, prompts } = drive({ preview: blocked });
        await flow.open(OFF_SALE);

        await flow.announce();

        assert.deepEqual(prompts, []);
    });

    // @requirement SC-BUN-039 — An add-on retirement is announced for exactly the bookings the operator was shown
    test('a preview that changed meanwhile replaces the one shown, and says so', async () => {
        const now = previewOf({ reached: [reachedBooking('sb-1')] });
        const { flow } = drive({
            announce: async () => {
                throw new AdminError({
                    status: 409,
                    code: 'RETIREMENT_PREVIEW_CHANGED',
                    body: { code: 'RETIREMENT_PREVIEW_CHANGED', preview: now },
                });
            },
        });
        await flow.open(OFF_SALE);

        await flow.announce();

        assert.deepEqual(flow.preview.value, now);
        assert.equal(
            flow.error.value,
            'The bookings it reaches have changed. Check the updated preview and announce again.',
        );
        assert.equal(flow.result.value, null);
        assert.equal(flow.announcing.value, false);
    });

    test('any other failure is shown, not swallowed', async () => {
        const { flow } = drive({
            announce: async () => {
                throw new AdminError({ status: 500, detail: 'database down' });
            },
        });
        await flow.open(OFF_SALE);

        await flow.announce();

        assert.equal(flow.error.value, 'database down');
        assert.equal(flow.announcing.value, false);
    });

    test('closing forgets the version', async () => {
        const { flow } = drive();
        await flow.open(OFF_SALE);

        flow.close();

        assert.equal(flow.target.value, null);
    });
});

describe('whom a preview misses, in words', () => {
    test('one line per reason, in the fixed order, worded by the reason', () => {
        const skip = (subscriptionBundleId, reason) => ({
            tenantId: 't',
            subscriptionId: 's',
            subscriptionBundleId,
            reason,
        });
        const preview = {
            skipped: [skip('a', 'already-told'), skip('b', 'ended'), skip('c', 'already-told')],
        };

        assert.deepEqual(
            retirementSkipLines(preview, {
                ended: '{count} ended',
                'cancelled-before': '{count} cancelled',
                'no-term': '{count} without a term',
                'already-told': '{count} told before',
            }),
            [
                { reason: 'ended', text: '1 ended' },
                { reason: 'already-told', text: '2 told before' },
            ],
        );
        assert.deepEqual(retirementSkipLines({ skipped: [] }, { ended: 'x' }), []);
    });
});
