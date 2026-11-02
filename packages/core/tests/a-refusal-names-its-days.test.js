// The values of a refusal that are days, written the way the reading page
// writes days — exactly the ones the refusal names, and nothing it does not.

// @requirement SC-UI-028 — Every day a tenant is shown is the installation's day, named by the server

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { writeDayParams } from '../dist/index.js';

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
