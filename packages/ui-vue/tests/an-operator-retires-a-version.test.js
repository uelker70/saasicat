// Retiring a plan version in the plan cockpit, driven without a page: where the
// action is offered, how a preview reads, and what the announcement sends —
// behind the second factor, with exactly the subscriptions the operator saw.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ref } from 'vue';

import {
    AdminError,
    blockerText,
    isRetirable,
    retirementDates,
    retirementOf,
    retirementSkips,
    useVersionRetirement,
} from '../dist/index.js';

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetDays) => new Date(NOW + offsetDays * DAY).toISOString();

/** A published plan version; `fields` say where it stands. */
const version = (fields = {}) => ({
    id: 'pv-1',
    planId: 'STANDARD',
    version: 1,
    publishedAt: iso(-400),
    supersededAt: null,
    validFrom: iso(-400),
    validUntil: null,
    endsAt: null,
    ...fields,
});

const SIDE = { planKey: 'STANDARD', monthlyNet: 49, yearlyNet: 490 };

/** A preview reaching the subscriptions in `reached` and missing those in `skipped`. */
const previewOf = ({ reached = [], skipped = [], blockers = [] } = {}) => ({
    retired: { ...SIDE, planVersionId: 'pv-1', version: 1 },
    replacement: { ...SIDE, planVersionId: 'pv-2', version: 2, monthlyNet: 59 },
    changes: [],
    asOf: iso(0),
    reached,
    skipped,
    blockers,
});
const reached = (subscriptionId, effectiveAt, lastDayToCancel) => ({
    tenantId: 't',
    subscriptionId,
    status: 'ACTIVE',
    billingCycle: 'MONTHLY',
    effectiveAt,
    lastDayToCancel,
    reachedRecently: false,
});

// @requirement SC-SUB-025 — A version is retired only off sale, and only where the operator's terms allow it
describe('where retiring is offered', () => {
    test('on a version no longer on sale, and on no other', () => {
        assert.equal(isRetirable(version({ validUntil: iso(-2) }), new Date(NOW)), true);
        assert.equal(isRetirable(version(), new Date(NOW)), false, 'on sale');
        assert.equal(isRetirable(version({ publishedAt: null }), new Date(NOW)), false, 'a draft');
        assert.equal(
            isRetirable(version({ validFrom: iso(10) }), new Date(NOW)),
            false,
            'scheduled',
        );
    });
});

describe('how a preview reads', () => {
    test('the dates subscriptions move on, the earliest first, counted', () => {
        const preview = previewOf({
            reached: [
                reached('s-1', '2027-02-01T00:00:00.000Z', '2027-01-31'),
                reached('s-2', '2027-01-15T00:00:00.000Z', '2027-01-14'),
                reached('s-3', '2027-02-01T00:00:00.000Z', '2027-01-31'),
            ],
        });

        assert.deepEqual(retirementDates(preview), [
            { effectiveAt: '2027-01-15T00:00:00.000Z', lastDayToCancel: '2027-01-14', count: 1 },
            { effectiveAt: '2027-02-01T00:00:00.000Z', lastDayToCancel: '2027-01-31', count: 2 },
        ]);
    });

    test('the subscriptions it misses, counted by reason in a fixed order, none left at zero', () => {
        const skip = (subscriptionId, reason) => ({ tenantId: 't', subscriptionId, reason });
        const preview = previewOf({
            skipped: [
                skip('a', 'already-told'),
                skip('b', 'changes-before'),
                skip('c', 'ended'),
                skip('d', 'changes-before'),
            ],
        });

        assert.deepEqual(retirementSkips(preview), [
            { reason: 'ended', count: 1 },
            { reason: 'changes-before', count: 2 },
            { reason: 'already-told', count: 1 },
        ]);
        assert.deepEqual(retirementSkips(previewOf()), []);
    });

    test('the announcement that retired a version is the most recent one, as the server lists them', () => {
        const records = [
            { id: 'r-2', retired: { planVersionId: 'pv-1' } },
            { id: 'r-1', retired: { planVersionId: 'pv-1' } },
            { id: 'r-0', retired: { planVersionId: 'pv-0' } },
        ];

        assert.equal(retirementOf(records, 'pv-1').id, 'r-2');
        assert.equal(retirementOf(records, 'pv-9'), null);
    });

    test("a blocker in the operator's words, the server's where the catalogue has none", () => {
        const blocker = {
            code: 'RETIREMENT_VERSION_ON_SALE',
            message: 'Version 1 of STANDARD is still on sale.',
            params: { planKey: 'STANDARD', version: 1 },
        };

        assert.equal(
            blockerText(blocker, { RETIREMENT_VERSION_ON_SALE: 'v{version} von {planKey}' }),
            'v1 von STANDARD',
        );
        assert.equal(blockerText(blocker, {}), 'Version 1 of STANDARD is still on sale.');
    });
});

/**
 * The cockpit's flow over resources that record what they were asked, and a
 * second-factor prompt answered with `code` (or cancelled, for `null`).
 */
function drive({
    capability = true,
    versionsOf = () => [version({ id: 'pv-2', version: 2 })],
    preview = previewOf({ reached: [reached('s-1', iso(120), '2027-01-31')] }),
    announce = async () => ({ retirement: { id: 'r-1' }, told: 1, failed: 0 }),
    code = '123456',
    list = async () => [],
    plan = { id: 'plan-standard', planKey: 'STANDARD' },
} = {}) {
    const requests = [];
    const prompts = [];
    const flow = useVersionRetirement({
        plan: ref(plan),
        manifest: ref({ capabilities: capability ? { 'planVersions.retire': true } : {} }),
        plans: {
            list: async () => [
                { id: 'plan-standard', planKey: 'STANDARD', label: 'Standard' },
                { id: 'plan-pro', planKey: 'PRO', label: 'Pro' },
            ],
        },
        versions: {
            listForPlan: async (planId) => {
                requests.push(['listForPlan', planId]);
                return versionsOf(planId);
            },
        },
        retirements: {
            list: async () => {
                requests.push(['list']);
                return list();
            },
            preview: async (...args) => {
                requests.push(['preview', ...args]);
                return typeof preview === 'function' ? preview(...args) : preview;
            },
            announce: async (...args) => {
                requests.push(['announce', ...args]);
                return announce(...args);
            },
        },
        mfa: {
            async run(description, _invalid, action) {
                prompts.push(description);
                if (code === null) return { done: false };
                return { done: true, value: await action(code) };
            },
        },
    });
    return { flow, requests, prompts };
}

const OFF_SALE = version({ validUntil: iso(-2) });

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the retirement flow', () => {
    test('offers the action only where the platform serves it', () => {
        assert.equal(drive().flow.canRetire(OFF_SALE), true);
        assert.equal(drive({ capability: false }).flow.canRetire(OFF_SALE), false);
        assert.equal(drive().flow.canRetire(version()), false, 'a version on sale');
    });

    test('reads no announcements while no plan is open', async () => {
        const { requests } = drive({ plan: null });
        await settled();

        assert.deepEqual(requests, []);
    });

    test('reads the announcements made where retiring is offered, and none elsewhere', async () => {
        const record = { id: 'r-1', retired: { planVersionId: 'pv-1' } };
        const served = drive({ list: async () => [record] });
        const unserved = drive({ capability: false, list: async () => [record] });
        await settled();

        assert.equal(served.flow.retirementOf(OFF_SALE).id, 'r-1');
        assert.deepEqual(unserved.requests, []);
        assert.equal(unserved.flow.retirementOf(OFF_SALE), null);
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

    test("opens on the version's own plan, its version on sale as the replacement", async () => {
        const { flow, requests } = drive();
        await settled();
        requests.length = 0;

        await flow.open(OFF_SALE);

        assert.equal(flow.replacementPlanId.value, 'plan-standard');
        assert.equal(flow.replacement.value.id, 'pv-2');
        assert.deepEqual(requests, [
            ['listForPlan', 'plan-standard'],
            ['preview', 'pv-1', 'pv-2'],
        ]);
        assert.equal(flow.preview.value.reached.length, 1);
    });

    test('a plan with no version on sale has no replacement and asks for no preview', async () => {
        const { flow, requests } = drive({
            versionsOf: (planId) =>
                planId === 'plan-pro' ? [version({ id: 'pv-p', validUntil: iso(-5) })] : [],
        });
        await flow.open(OFF_SALE);
        requests.length = 0;

        await flow.choosePlan('plan-pro');

        assert.equal(flow.replacement.value, null);
        assert.equal(flow.preview.value, null);
        assert.deepEqual(requests, [['listForPlan', 'plan-pro']]);
    });

    // @requirement SC-SUB-026 — A retirement is announced for exactly the subscriptions the operator was shown
    test('announces behind the second factor, naming the replacement and whom it was shown', async () => {
        const { flow, requests, prompts } = drive();
        await flow.open(OFF_SALE);

        await flow.announce();

        assert.equal(prompts.length, 1);
        assert.match(prompts[0], /STANDARD/);
        assert.deepEqual(requests.at(-2), [
            'announce',
            'pv-1',
            { replacementPlanVersionId: 'pv-2', subscriptionIds: ['s-1'] },
            '123456',
        ]);
        assert.deepEqual(flow.result.value, { retirement: { id: 'r-1' }, told: 1, failed: 0 });
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
            reached: [reached('s-1', iso(120), '2027-01-31')],
            blockers: [
                { code: 'RETIREMENT_WITHIN_TWELVE_MONTHS', message: 'm', params: { count: 1 } },
            ],
        });
        const { flow, prompts } = drive({ preview: blocked });
        await flow.open(OFF_SALE);

        await flow.announce();

        assert.deepEqual(prompts, []);
    });

    // @requirement SC-SUB-026 — A retirement is announced for exactly the subscriptions the operator was shown
    test('a preview that changed meanwhile replaces the one shown, and says so', async () => {
        const now = previewOf({
            reached: [
                reached('s-1', iso(120), '2027-01-31'),
                reached('s-2', iso(120), '2027-01-31'),
            ],
        });
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
        assert.ok(flow.error.value);
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
    });

    test('closing forgets the version', async () => {
        const { flow } = drive();
        await flow.open(OFF_SALE);

        flow.close();

        assert.equal(flow.target.value, null);
    });
});
