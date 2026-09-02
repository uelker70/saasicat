// `GET /admin/settings` and the one thing anybody can do to the record.
//
// Direct instantiation, like the other controller tests: the controller is a
// mapping layer over the catalogue and the port, and what these hold is the
// mapping — which value is read off the catalogue and which off the record,
// when `appliedAt` is null, what a change looks like on the wire, and that an
// acknowledgement is audited as the operator's action and refused by name where
// nothing recorded the id.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { settingsSubtreeOf } from '@saasicat/core';

import { buildSettingsController, fingerprintOf } from '../dist/index.js';

const CATALOG = {
    schemaVersion: 1,
    app: { name: 'Demo' },
    currency: 'EUR',
    vatRate: 19,
    tenantBilling: {
        cancellationNoticeDays: { monthly: 14, yearly: 90 },
        selfServiceBlockedPlans: { asTarget: [], asSource: [] },
    },
    plans: [{ id: 'PRO', quotas: { users: 1 }, features: [] }],
};
const SOURCE = '/srv/app/config/saas.yaml';
const RUNNING = settingsSubtreeOf(CATALOG);
const NOTICED = new Date('2026-09-01T06:30:00.000Z');

function fakePort({ applied = null, changes = [] } = {}) {
    return {
        applied,
        changes,
        acknowledged: [],
        async readApplied() {
            return this.applied;
        },
        async writeApplied() {},
        async recordChange() {
            throw new Error('not in this test');
        },
        async listChanges(filter = {}) {
            return filter.limit === undefined ? this.changes : this.changes.slice(0, filter.limit);
        },
        async acknowledgeChange(id, by, at) {
            const change = this.changes.find((c) => c.id === id);
            if (!change) return null;
            this.acknowledged.push({ id, by, at });
            if (change.acknowledgedAt === null)
                Object.assign(change, { acknowledgedAt: at, acknowledgedBy: by });
            return change;
        },
    };
}

/** The audit helper, recording what it was asked to log. */
function fakeAudit() {
    return {
        logged: [],
        actorTagFromRequest(req) {
            return `web:${req.user.email}:${req.headers['x-session-id']}`;
        },
        async logFromRequest(req, entity, entityId, action, changes) {
            this.logged.push({ entity, entityId, action, changes, email: req.user.email });
        },
    };
}

const REQUEST = {
    user: { id: 'u-1', email: 'ops@example.com' },
    headers: { 'x-session-id': 's-1' },
};

function controllerWith(port, audit = fakeAudit()) {
    const Controller = buildSettingsController([]);
    return { controller: new Controller(CATALOG, SOURCE, port, audit), audit };
}

const change = (id, previous, current, acknowledged = null) => ({
    id,
    noticedAt: NOTICED,
    source: SOURCE,
    previous,
    current,
    acknowledgedAt: acknowledged,
    acknowledgedBy: acknowledged ? 'web:first@example.com:s-0' : null,
});

// @requirement SC-CFG-008 — An operator can see when the running configuration was applied, and from where
describe('what the endpoint says about the running configuration', () => {
    test('the values, fingerprint and source come off the catalogue, the moment off the record', async () => {
        const appliedAt = new Date('2026-08-30T10:00:00.000Z');
        const port = fakePort({
            applied: {
                fingerprint: fingerprintOf(RUNNING),
                settings: RUNNING,
                source: SOURCE,
                appliedAt,
            },
        });
        const { controller } = controllerWith(port);
        const view = await controller.getSettings();
        assert.equal(view.source, SOURCE);
        assert.equal(view.fingerprint, fingerprintOf(RUNNING));
        assert.deepEqual(view.settings, RUNNING);
        assert.equal(view.recorded, true);
        assert.equal(view.appliedAt, appliedAt.toISOString());
        assert.deepEqual(view.changes, []);
    });

    test('a record that describes another configuration gives no moment, and says so by null', async () => {
        const stale = { ...RUNNING, vatRate: 7 };
        const port = fakePort({
            applied: {
                fingerprint: fingerprintOf(stale),
                settings: stale,
                source: SOURCE,
                appliedAt: new Date('2026-08-30T10:00:00.000Z'),
            },
        });
        const { controller } = controllerWith(port);
        const view = await controller.getSettings();
        assert.equal(view.recorded, true);
        assert.equal(view.appliedAt, null);
        // The values shown are the RUNNING ones, never the record's.
        assert.equal(view.settings.vatRate, 19);
    });

    test('without a port the running values are still answered, and nothing is claimed about a record', async () => {
        const { controller } = controllerWith(null);
        const view = await controller.getSettings();
        assert.equal(view.recorded, false);
        assert.equal(view.appliedAt, null);
        assert.deepEqual(view.settings, RUNNING);
        assert.deepEqual(view.changes, []);
    });

    test('a change arrives with what moved, both values, and its acknowledgement', async () => {
        const port = fakePort({
            changes: [
                change('c-2', { ...RUNNING, vatRate: 7 }, RUNNING),
                change(
                    'c-1',
                    RUNNING,
                    { ...RUNNING, vatRate: 7 },
                    new Date('2026-08-31T00:00:00.000Z'),
                ),
            ],
        });
        const { controller } = controllerWith(port);
        const [open, seen] = (await controller.getSettings()).changes;
        assert.equal(open.id, 'c-2');
        assert.equal(open.noticedAt, NOTICED.toISOString());
        assert.deepEqual(open.differences, [{ path: 'vatRate', before: 7, after: 19 }]);
        assert.equal(open.acknowledgedAt, null);
        assert.equal(seen.acknowledgedAt, '2026-08-31T00:00:00.000Z');
        assert.equal(seen.acknowledgedBy, 'web:first@example.com:s-0');
    });
});

// @requirement SC-CFG-031 — A recorded change survives until an operator acknowledges it
describe('acknowledging a change', () => {
    test("records who and when, is audited as the operator's action, and answers the record", async () => {
        const port = fakePort({ changes: [change('c-1', { ...RUNNING, vatRate: 7 }, RUNNING)] });
        const { controller, audit } = controllerWith(port);

        const view = await controller.acknowledge('c-1', REQUEST);
        assert.equal(view.acknowledgedBy, 'web:ops@example.com:s-1');
        assert.ok(view.acknowledgedAt, 'a moment expected');
        assert.equal(port.acknowledged[0].by, 'web:ops@example.com:s-1');
        assert.deepEqual(
            audit.logged.map((entry) => [entry.entity, entry.entityId, entry.action, entry.email]),
            [['SettingsChange', 'c-1', 'SETTINGS_CHANGE_ACKNOWLEDGE', 'ops@example.com']],
        );
    });

    test('without the audit logger, the author is derived the same way — and nothing is audited', async () => {
        // A consumer mounting `buildSettingsController` in a module of their own
        // has no `WebAuditLogger` to hand it; the acknowledgement still names
        // who did it, from the same request fields the logger reads.
        const port = fakePort({ changes: [change('c-1', { ...RUNNING, vatRate: 7 }, RUNNING)] });
        const { controller } = controllerWith(port, null);
        const view = await controller.acknowledge('c-1', REQUEST);
        assert.equal(view.acknowledgedBy, 'web:ops@example.com:s-1');
        assert.equal(port.acknowledged[0].by, 'web:ops@example.com:s-1');
    });

    test('a second acknowledgement keeps the first author and answers the record as it stands', async () => {
        const first = new Date('2026-08-31T00:00:00.000Z');
        const port = fakePort({
            changes: [change('c-1', { ...RUNNING, vatRate: 7 }, RUNNING, first)],
        });
        const { controller } = controllerWith(port);
        const view = await controller.acknowledge('c-1', REQUEST);
        assert.equal(view.acknowledgedBy, 'web:first@example.com:s-0');
        assert.equal(view.acknowledgedAt, first.toISOString());
    });

    test('an id nothing recorded is refused by name', async () => {
        const { controller, audit } = controllerWith(fakePort());
        await assert.rejects(
            () => controller.acknowledge('no-such-change', REQUEST),
            (error) => {
                assert.ok(error instanceof NotFoundException);
                assert.equal(error.getResponse().code, 'SETTINGS_CHANGE_NOT_FOUND');
                return true;
            },
        );
        assert.deepEqual(audit.logged, [], 'nothing happened, so nothing is audited');
    });

    test('an installation that keeps no record has nothing to acknowledge', async () => {
        const { controller } = controllerWith(null);
        await assert.rejects(
            () => controller.acknowledge('c-1', REQUEST),
            (error) => error instanceof NotFoundException,
        );
    });
});
