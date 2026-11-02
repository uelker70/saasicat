// The values of a refusal that are days, written the way the reading page
// writes days — exactly the ones the refusal names, and nothing it does not.

// @requirement SC-UI-028 — Every day a tenant is shown is the installation's day, named by the server

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
    noActivePlanVersion,
    refusalBodyIn,
    subscriptionGone,
    writeDayParams,
} from '../dist/index.js';

const write = (day) => `<${day}>`;

describe('the days a refusal names', () => {
    test('are written by the page, each one it names', () => {
        assert.deepEqual(
            writeDayParams(
                { until: '2026-12-01', lastDay: '2026-11-30', bundleName: 'Export' },
                ['until', 'lastDay'],
                write,
            ),
            { until: '<2026-12-01>', lastDay: '<2026-11-30>', bundleName: 'Export' },
        );
    });

    test('and nothing it does not name, though it looks like a day', () => {
        assert.deepEqual(writeDayParams({ reference: '2026-12-24' }, ['until'], write), {
            reference: '2026-12-24',
        });
    });

    test('leave a named value that is not text as it is', () => {
        assert.deepEqual(writeDayParams({ count: 3 }, ['count'], write), { count: 3 });
    });

    for (const [what, dayParams] of [
        ['nothing', undefined],
        ['a text rather than a list', 'until'],
        ['a list of anything but names', [7, null, { until: true }]],
    ]) {
        test(`are none where the refusal says ${what}`, () => {
            assert.deepEqual(writeDayParams({ until: '2026-12-01' }, dayParams, write), {
                until: '2026-12-01',
            });
        });
    }

    test('leave the refusal they were read from as it was', () => {
        const params = { until: '2026-12-01' };
        writeDayParams(params, ['until'], write);
        assert.deepEqual(params, { until: '2026-12-01' });
    });
});

describe('a refusal an adapter raises, as the platform answers it', () => {
    /** Half past midnight on 1 July in Berlin: still 30 June in UTC. */
    const AFTER_MIDNIGHT_IN_BERLIN = new Date('2026-06-30T22:30:00.000Z');

    test('names its day in the installation’s zone, says it is a day, and says it in English too', () => {
        assert.deepEqual(
            refusalBodyIn(noActivePlanVersion('PRO', AFTER_MIDNIGHT_IN_BERLIN), 'Europe/Berlin'),
            {
                code: 'NO_ACTIVE_PLAN_VERSION',
                message: 'No version of plan PRO is on sale as of 2026-07-01.',
                params: { planId: 'PRO', asOf: '2026-07-01' },
                dayParams: ['asOf'],
            },
        );
    });

    test('while the adapter itself names the UTC day, knowing no zone', () => {
        const refusal = noActivePlanVersion('PRO', AFTER_MIDNIGHT_IN_BERLIN);
        assert.deepEqual(refusal.params, { planId: 'PRO', asOf: '2026-06-30' });
        assert.equal(refusalBodyIn(refusal, 'UTC').params.asOf, '2026-06-30');
    });

    test('is answered as it came where another, older copy of core built it without moments', () => {
        const foreign = Object.assign(new Error('No subscription for tenant t1.'), {
            name: 'PersistenceRefusal',
            code: 'SUBSCRIPTION_NOT_FOUND',
            reason: 'gone',
            params: { tenantId: 't1' },
        });
        assert.deepEqual(refusalBodyIn(foreign, 'Europe/Berlin'), {
            code: 'SUBSCRIPTION_NOT_FOUND',
            message: 'No subscription for tenant t1.',
            params: { tenantId: 't1' },
        });
    });

    test('is answered as it came where it names no day', () => {
        const refusal = subscriptionGone('t1');
        assert.deepEqual(refusalBodyIn(refusal, 'Europe/Berlin'), {
            code: refusal.code,
            message: refusal.message,
            params: refusal.params,
        });
    });
});
