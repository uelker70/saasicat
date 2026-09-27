// What a tenant's page is told about maintenance, driven without a page: the
// status it asks for, how often, what it keeps when it cannot ask, and the
// refusal an application's own request met.

// @requirement SC-UI-026 — A tenant locked out for maintenance sees one page that says so, and carries on afterwards

import { afterEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { effectScope, nextTick } from 'vue';

import {
    MAINTENANCE_LOCKED_POLL_MS,
    MAINTENANCE_STATUS_POLL_MS,
    maintenanceRefusalOf,
    onMaintenanceRefusal,
    reportMaintenanceRefusal,
    useMaintenanceStatus,
} from '../dist/index.js';

afterEach(() => mock.timers.reset());

const LOCKED = {
    state: 'locked',
    lockedAt: '2026-10-02T20:03:00.000Z',
    endsAt: '2026-10-02T21:00:00.000Z',
    message: null,
    overrun: false,
};

async function settled() {
    for (let i = 0; i < 4; i += 1) {
        await nextTick();
        await Promise.resolve();
    }
}

/** A status route answering `answer()` each time it is asked. */
function statusRoute(answer) {
    const asked = [];
    const http = async (url) => {
        asked.push(url);
        const [status, body] = answer();
        if (status === 0) throw new Error('offline');
        return {
            status,
            headers: { get: () => 'application/json' },
            json: async () => body,
            text: async () => JSON.stringify(body),
        };
    };
    return { http, asked };
}

function watching(answer, options = {}) {
    const { http, asked } = statusRoute(answer);
    const scope = effectScope();
    const state = scope.run(() => useMaintenanceStatus({ http, apiBase: '/api/', ...options }));
    return { state, asked, scope };
}

describe('recognising the lock’s refusal', () => {
    test('a 503 with the code MAINTENANCE is one, with the window it carries', () => {
        assert.deepEqual(
            maintenanceRefusalOf(503, { code: 'MAINTENANCE', maintenance: LOCKED }),
            LOCKED,
        );
    });

    test('a refusal that carries no window still means the lock holds', () => {
        assert.equal(maintenanceRefusalOf(503, { code: 'MAINTENANCE' })?.state, 'locked');
    });

    test('another status, another code or a page that is not JSON is not', () => {
        assert.equal(maintenanceRefusalOf(500, { code: 'MAINTENANCE' }), null);
        assert.equal(maintenanceRefusalOf(503, { code: 'SOMETHING_ELSE' }), null);
        assert.equal(maintenanceRefusalOf(503, '<html>Bad gateway</html>'), null);
        assert.equal(maintenanceRefusalOf(503, null), null);
    });

    test('a report reaches every listener until it stops listening', () => {
        const heard = [];
        const stop = onMaintenanceRefusal((status) => heard.push(status.state));
        assert.equal(
            reportMaintenanceRefusal(503, { code: 'MAINTENANCE', maintenance: LOCKED }),
            true,
        );
        assert.equal(reportMaintenanceRefusal(404, {}), false);
        stop();
        reportMaintenanceRefusal(503, { code: 'MAINTENANCE', maintenance: LOCKED });
        assert.deepEqual(heard, ['locked']);
    });
});

describe('the status a tenant’s page reads', () => {
    test('asks the status route under the given base, once at first', async () => {
        const { state, asked, scope } = watching(() => [200, { state: 'none' }]);
        await settled();
        assert.deepEqual(asked, ['/api/public/maintenance']);
        assert.deepEqual(state.status.value, { state: 'none' });
        scope.stop();
    });

    test('asks again every minute, and every quarter of a minute while locked', async () => {
        mock.timers.enable({ apis: ['setTimeout'] });
        let answer = [200, { state: 'none' }];
        const { asked, scope } = watching(() => answer);
        await settled();
        mock.timers.tick(MAINTENANCE_STATUS_POLL_MS);
        await settled();
        assert.equal(asked.length, 2);
        answer = [200, LOCKED];
        mock.timers.tick(MAINTENANCE_STATUS_POLL_MS);
        await settled();
        mock.timers.tick(MAINTENANCE_LOCKED_POLL_MS);
        await settled();
        assert.equal(asked.length, 4);
        scope.stop();
    });

    test('what cannot be asked leaves what was known standing', async () => {
        mock.timers.enable({ apis: ['setTimeout'] });
        let answer = [200, LOCKED];
        const { state, scope } = watching(() => answer);
        await settled();
        for (answer of [
            [0, null],
            [404, {}],
            [200, { unexpected: true }],
        ]) {
            mock.timers.tick(MAINTENANCE_LOCKED_POLL_MS);
            await settled();
            assert.equal(state.status.value.state, 'locked', `after ${answer[0]}`);
        }
        scope.stop();
    });

    test('a reported refusal locks at once and is remembered until the lock is lifted', async () => {
        mock.timers.enable({ apis: ['setTimeout'] });
        let answer = [200, { state: 'none' }];
        const { state, scope } = watching(() => answer);
        await settled();
        reportMaintenanceRefusal(503, { code: 'MAINTENANCE', maintenance: LOCKED });
        assert.equal(state.status.value.state, 'locked');
        assert.equal(state.refused.value, true);
        answer = [200, { state: 'none' }];
        mock.timers.tick(MAINTENANCE_LOCKED_POLL_MS);
        await settled();
        assert.equal(state.status.value.state, 'none');
        assert.equal(state.refused.value, false);
        scope.stop();
    });

    test('stops asking, and stops listening, when the page goes', async () => {
        mock.timers.enable({ apis: ['setTimeout'] });
        const { state, asked, scope } = watching(() => [200, { state: 'none' }]);
        await settled();
        scope.stop();
        mock.timers.tick(MAINTENANCE_STATUS_POLL_MS * 3);
        await settled();
        reportMaintenanceRefusal(503, { code: 'MAINTENANCE', maintenance: LOCKED });
        assert.equal(asked.length, 1);
        assert.equal(state.status.value.state, 'none');
    });
});
