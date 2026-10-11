// The withdrawn-features page's two flows, driven without a page: the list and
// lifting one withdrawal, and announcing a new one — what the operator is
// shown, what is sent behind the second factor, and what a refusal, a
// cancelled code or an answer that arrives too late leaves behind.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { nextTick } from 'vue';

import {
    AdminError,
    featureWithdrawalTargetKeyOf,
    useFeatureWithdrawalAnnouncement,
    useFeatureWithdrawals,
} from '../dist/index.js';
import { answeringSecondFactor } from './support/retirement-flow.mjs';

async function settled() {
    await nextTick();
    await new Promise((tick) => setTimeout(tick, 0));
}

const ROW = {
    id: 'fw-1',
    featureKey: 'EXPORT',
    featureLabel: 'Data export',
    reason: 'The export service has been switched off.',
    effectiveFrom: '2026-07-01T00:00:00.000Z',
    liftedFrom: null,
    reductions: [],
    announcedAt: '2026-06-15T10:00:00.000Z',
    announcedBy: 'web:ops@example.com:admin',
    liftedAt: null,
    liftedBy: null,
    progress: { reached: 2, told: 2, endedAtOnce: 0 },
};

function driveList({ code = '123456', lift } = {}) {
    const requests = [];
    const prompts = [];
    const resource = {
        list: async () => {
            requests.push(['list']);
            return [ROW];
        },
        lift: async (...args) => {
            requests.push(['lift', ...args]);
            return lift ? lift(...args) : { withdrawal: { id: args[0] }, told: 2, failed: 0 };
        },
    };
    const state = useFeatureWithdrawals(resource, answeringSecondFactor({ prompts, code }));
    return { state, requests, prompts };
}

// @requirement SC-SUB-042 — The operator withdraws a feature from everybody who holds it, and tells them at once
describe('the list of withdrawals, and lifting one', () => {
    test('reads every withdrawal when the page opens', async () => {
        const { state, requests } = driveList();
        await settled();
        assert.deepEqual(state.rows.value, [ROW]);
        assert.deepEqual(requests, [['list']]);
    });

    test('lifts from the date chosen behind the second factor, naming the feature, and reads the list again', async () => {
        const { state, requests, prompts } = driveList();
        await settled();
        const lifted = await state.lift(ROW, '2026-08-01T00:00:00.000Z');
        assert.deepEqual(lifted, { withdrawal: { id: 'fw-1' }, told: 2, failed: 0 });
        assert.deepEqual(requests, [
            ['list'],
            ['lift', 'fw-1', '2026-08-01T00:00:00.000Z', '123456'],
            ['list'],
        ]);
        assert.match(prompts[0], /Data export/);
    });

    test('a cancelled code lifts nothing and says nothing was written', async () => {
        const { state, requests } = driveList({ code: null });
        await settled();
        assert.equal(await state.lift(ROW, null), null);
        assert.deepEqual(requests, [['list']]);
    });

    test('a refusal reaches the dialog, which keeps the form and shows why', async () => {
        const refusal = new AdminError({ status: 409, code: 'FEATURE_WITHDRAWAL_ALREADY_LIFTED' });
        const { state, requests } = driveList({
            lift: () => {
                throw refusal;
            },
        });
        await settled();
        await assert.rejects(
            () => state.lift(ROW, null),
            (err) => err === refusal,
        );
        assert.deepEqual(requests, [['list'], ['lift', 'fw-1', null, '123456']]);
    });
});

const LINE = {
    line: 'plan',
    key: 'PRO',
    label: 'Pro',
    subscriptionBundleId: null,
    billingCycle: 'MONTHLY',
    priceNet: 49,
};
const PRO = {
    kind: 'plan',
    key: 'PRO',
    label: 'Pro',
    billingCycle: 'MONTHLY',
    lines: 2,
    lowestPriceNet: 49,
};

function previewOf({ featureKey = 'EXPORT', reached = ['s-1', 's-2'], blockers = [] } = {}) {
    return {
        feature: { key: featureKey, label: featureKey === 'EXPORT' ? 'Data export' : featureKey },
        effectiveFrom: '2026-07-01T00:00:00.000Z',
        asOf: '2026-06-15T10:00:00.000Z',
        reached: reached.map((subscriptionId) => ({
            tenantId: `t-${subscriptionId}`,
            subscriptionId,
            status: 'ACTIVE',
            lines: [LINE],
            specialTerms: false,
        })),
        skipped: [],
        targets: [PRO],
        blockers,
    };
}

function driveAnnouncement({ code = '123456', preview, announce } = {}) {
    const requests = [];
    const prompts = [];
    let announced = 0;
    const flow = useFeatureWithdrawalAnnouncement({
        withdrawals: {
            preview: async (...args) => {
                requests.push(['preview', ...args]);
                return preview ? preview(...args) : previewOf({ featureKey: args[0] });
            },
            announce: async (...args) => {
                requests.push(['announce', ...args]);
                return announce
                    ? announce(...args)
                    : { withdrawal: { id: 'fw-1' }, told: 2, failed: 0 };
            },
        },
        catalog: {
            features: async () => [
                { featureKey: 'EXPORT', label: 'Data export', deletedAt: null },
                { featureKey: 'FAX', label: 'Fax', deletedAt: '2026-01-01T00:00:00.000Z' },
            ],
        },
        mfa: answeringSecondFactor({ prompts, code }),
        onAnnounced: async () => {
            announced += 1;
        },
    });
    return { flow, requests, prompts, announced: () => announced };
}

/** Opens the dialog, chooses EXPORT and gives a reason: ready to announce at once. */
async function readyToAnnounce(options) {
    const driven = driveAnnouncement(options);
    await driven.flow.open();
    await driven.flow.chooseFeature('EXPORT');
    driven.flow.setReason('  The export service has been switched off.  ');
    return driven;
}

const writes = (requests) => requests.filter(([name]) => name === 'announce');

// @requirement SC-SUB-042 — The operator withdraws a feature from everybody who holds it, and tells them at once
describe('announcing a withdrawal', () => {
    test('offers every feature the catalogue still has', async () => {
        const { flow } = driveAnnouncement();
        await flow.open();
        assert.equal(flow.isOpen.value, true);
        assert.deepEqual(
            flow.features.value.map((feature) => feature.featureKey),
            ['EXPORT'],
        );
    });

    test('reads the preview at once where no date is chosen, and from the date where one is', async () => {
        const { flow, requests } = driveAnnouncement();
        await flow.open();
        await flow.chooseFeature('EXPORT');
        await flow.chooseDate('2026-07-01T09:30');
        assert.deepEqual(requests, [
            ['preview', 'EXPORT', null],
            ['preview', 'EXPORT', new Date('2026-07-01T09:30').toISOString()],
        ]);
        assert.equal(flow.preview.value.feature.key, 'EXPORT');
    });

    test('asks for at once again when the date is cleared', async () => {
        const { flow, requests } = driveAnnouncement();
        await flow.open();
        await flow.chooseFeature('EXPORT');
        await flow.chooseDate('2026-07-01T09:30');
        await flow.chooseDate('');
        assert.deepEqual(requests.at(-1), ['preview', 'EXPORT', null]);
    });

    test('asks nothing for a date it cannot read, rather than taking it for at once', async () => {
        const { flow, requests } = driveAnnouncement();
        await flow.open();
        await flow.chooseFeature('EXPORT');
        await flow.chooseDate('not a date');
        assert.deepEqual(requests, [['preview', 'EXPORT', null]]);
        assert.equal(flow.preview.value, null);
        assert.equal(flow.loading.value, false);
    });

    test('keeps the answer to the latest question, not the one that arrives last', async () => {
        const answers = {};
        const { flow } = driveAnnouncement({
            preview: (featureKey) =>
                new Promise((resolve) => {
                    answers[featureKey] = () => resolve(previewOf({ featureKey }));
                }),
        });
        await flow.open();
        const first = flow.chooseFeature('EXPORT');
        const second = flow.chooseFeature('FAX');
        answers.FAX();
        await second;
        answers.EXPORT();
        await first;
        assert.equal(flow.preview.value.feature.key, 'FAX');
        assert.equal(flow.loading.value, false);
    });

    test('a preview that fails says why and shows none', async () => {
        const { flow } = driveAnnouncement({
            preview: () => {
                throw new AdminError({ status: 500, detail: 'database down' });
            },
        });
        await flow.open();
        await flow.chooseFeature('EXPORT');
        assert.equal(flow.preview.value, null);
        assert.equal(flow.error.value, 'database down');
    });

    test('is offered once a reason is given, and not while anything refuses it', async () => {
        const { flow } = await readyToAnnounce();
        assert.equal(flow.canAnnounce.value, true);

        flow.setReason('   ');
        assert.equal(flow.canAnnounce.value, false, 'without a reason');
        flow.setReason('Switched off.');

        flow.setAmount(featureWithdrawalTargetKeyOf(PRO), 50);
        assert.equal(flow.canAnnounce.value, false, 'with a reduction above the lowest price');
        flow.setAmount(featureWithdrawalTargetKeyOf(PRO), 5);
        assert.equal(flow.canAnnounce.value, true);

        const blocked = await readyToAnnounce({
            preview: () =>
                previewOf({
                    blockers: [{ code: 'FEATURE_WITHDRAWAL_OPEN', message: 'open', params: {} }],
                }),
        });
        assert.equal(blocked.flow.canAnnounce.value, false, 'with a blocker');
        assert.equal(await blocked.flow.submit(), null);
        assert.deepEqual(writes(blocked.requests), [], 'and submitting sends nothing');
    });

    test('announces at once, with the reason, the reductions and the subscriptions shown', async () => {
        const { flow, requests, prompts, announced } = await readyToAnnounce();
        flow.setAmount(featureWithdrawalTargetKeyOf(PRO), 5);

        const announcedNow = await flow.submit();

        assert.deepEqual(writes(requests), [
            [
                'announce',
                {
                    featureKey: 'EXPORT',
                    reason: 'The export service has been switched off.',
                    reductions: [
                        { kind: 'plan', key: 'PRO', billingCycle: 'MONTHLY', amountNet: 5 },
                    ],
                    subscriptionIds: ['s-1', 's-2'],
                },
                '123456',
            ],
        ]);
        assert.match(prompts[0], /Data export/);
        assert.deepEqual(announcedNow, { withdrawal: { id: 'fw-1' }, told: 2, failed: 0 });
        assert.equal(announced(), 1, 'the page reads its list again');
    });

    test('announces from the date chosen, as an instant', async () => {
        const { flow, requests } = await readyToAnnounce();
        await flow.chooseDate('2026-07-01T09:30');
        await flow.submit();
        assert.equal(
            writes(requests)[0][1].effectiveFrom,
            new Date('2026-07-01T09:30').toISOString(),
        );
    });

    test('a cancelled code announces nothing, and says nothing was written', async () => {
        const { flow, requests, announced } = await readyToAnnounce({ code: null });
        assert.equal(await flow.submit(), null);
        assert.deepEqual(writes(requests), []);
        assert.equal(announced(), 0);
        assert.equal(flow.announcing.value, false);
    });

    test('a preview that changed meanwhile replaces the one shown, and says so', async () => {
        const now = previewOf({ reached: ['s-1', 's-2', 's-3'] });
        const { flow, announced } = await readyToAnnounce({
            announce: () => {
                throw new AdminError({
                    status: 409,
                    code: 'FEATURE_WITHDRAWAL_PREVIEW_CHANGED',
                    body: { code: 'FEATURE_WITHDRAWAL_PREVIEW_CHANGED', preview: now },
                });
            },
        });
        await assert.rejects(() => flow.submit(), /changed since they were shown/);
        assert.deepEqual(flow.preview.value, now);
        assert.equal(announced(), 0);
    });

    test('a refusal reaches the dialog, which keeps the form and shows why', async () => {
        const refusal = new AdminError({
            status: 422,
            code: 'FEATURE_WITHDRAWAL_REDUCTION_EXCEEDS_PRICE',
            detail: 'The reduction for PRO billed MONTHLY is more than the lowest price it reduces, 49.',
        });
        const { flow, announced } = await readyToAnnounce({
            announce: () => {
                throw refusal;
            },
        });
        await assert.rejects(
            () => flow.submit(),
            (err) => err === refusal,
        );
        assert.equal(announced(), 0);
        assert.equal(flow.announcing.value, false);
    });
});
