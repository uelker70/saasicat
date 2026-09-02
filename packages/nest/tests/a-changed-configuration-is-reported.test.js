// A configuration change is noticed and reported.
//
// `a-boot-records-what-it-applied` holds the record. This holds the other half
// of the promise: somebody is told. The record inside the application is
// unconditional — it is written whether or not anybody is mailed — and mail is
// the addition, never the substitute. So the states here are the two mail
// states crossed with the boot that finds a change: addresses and a port
// (mailed, one per address, with what moved); addresses and no port (recorded,
// and the boot log says so once); nobody named (recorded, and nothing said,
// because in-app only is what an installation of one operator asked for).
//
// Real boots, as the recorder tests are: `app.init()` runs the hook, and the
// email port is a fake that keeps what it was handed.

import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { SaaSiCatModule } from '../dist/platform/index.js';
import { fingerprintOf } from '../dist/index.js';
import { settingsSubtreeOf } from '@saasicat/core';

const NOTICE = { monthly: 14, yearly: 90 };
const BLOCKED = { asTarget: ['ENTERPRISE'], asSource: [] };
const ADDRESSES = ['ops@example.com', 'cfo@example.com'];

const catalogWith = (overrides = {}) => ({
    schemaVersion: 1,
    app: { name: 'TestApp' },
    currency: 'EUR',
    vatRate: 19,
    tenantBilling: { cancellationNoticeDays: NOTICE, selfServiceBlockedPlans: BLOCKED },
    plans: [{ id: 'PRO', name: 'Pro', monthlyNet: 9, yearlyNet: 90, features: [], quotas: {} }],
    ...overrides,
});

class FakeJwtGuard {
    canActivate() {
        return true;
    }
}

class FakeAppliedSettingsPort {
    applied = null;
    changes = [];
    async readApplied() {
        return this.applied;
    }
    async writeApplied(record) {
        this.applied = { ...record };
    }
    async recordChange(change) {
        const record = {
            id: `change-${this.changes.length + 1}`,
            ...change,
            acknowledgedAt: null,
            acknowledgedBy: null,
        };
        this.changes.unshift(record);
        return record;
    }
    async listChanges() {
        return this.changes;
    }
    async acknowledgeChange() {
        return null;
    }
}

/** Keeps every mail it was asked to send; `failing` addresses throw. */
class FakeEmailPort {
    sent = [];
    constructor(failing = []) {
        this.failing = failing;
    }
    async send(message) {
        if (this.failing.includes(message.to)) throw new Error(`smtp refused ${message.to}`);
        this.sent.push(message);
    }
}

/** A port whose record says the notice period was 0, so a boot on 14 is a change. */
function portWithAnOlderRecord() {
    const port = new FakeAppliedSettingsPort();
    const previous = settingsSubtreeOf(
        catalogWith({
            tenantBilling: {
                cancellationNoticeDays: { monthly: 0, yearly: 0 },
                selfServiceBlockedPlans: BLOCKED,
            },
        }),
    );
    port.applied = {
        fingerprint: fingerprintOf(previous),
        settings: previous,
        source: '/srv/app/config/saas.yaml',
        appliedAt: new Date('2026-08-01T06:00:00.000Z'),
    };
    return port;
}

const spec = {};
const persistenceWith = (appliedSettings) => ({
    capabilities: {
        transactions: true,
        pessimisticLocking: true,
        rowLevelSecurity: false,
        advisoryLocks: false,
    },
    core: { mfa: spec, audit: spec, rlsBypass: spec, transactionRunner: spec, appliedSettings },
});

async function boot(catalog, port, email) {
    const app = await Test.createTestingModule({
        imports: [
            SaaSiCatModule.forRoot({
                planCatalog: catalog,
                controller: { guards: [FakeJwtGuard] },
                discoverySnapshotPath: null,
                persistence: persistenceWith(port),
                adapters: email ? { email } : {},
                defaultPlanId: 'PRO',
            }),
        ],
    }).compile();
    await app.init();
    return app;
}

async function capturingLogs(fn) {
    const said = { warn: [], log: [], error: [] };
    const original = {
        warn: Logger.prototype.warn,
        log: Logger.prototype.log,
        error: Logger.prototype.error,
    };
    for (const level of Object.keys(said)) {
        Logger.prototype[level] = function (message) {
            said[level].push(String(message));
        };
    }
    try {
        return { said, result: await fn() };
    } finally {
        Object.assign(Logger.prototype, original);
    }
}

let app;
afterEach(async () => {
    await app?.close().catch(() => {});
    app = undefined;
});

// @requirement SC-CFG-009 — A configuration change is noticed and reported
// @requirement SC-CFG-029 — Who is told about a change lives in the configuration file
describe('addresses in the file and an email port bound', () => {
    test('every address is mailed what moved, and the change is recorded regardless', async () => {
        const port = portWithAnOlderRecord();
        const email = new FakeEmailPort();
        app = await boot(
            catalogWith({ notifications: { settingsChanged: ADDRESSES } }),
            port,
            email,
        );

        assert.deepEqual(
            email.sent.map((m) => m.to),
            ADDRESSES,
        );
        for (const mail of email.sent) {
            assert.match(mail.subject, /\[TestApp\].*configuration changed/);
            assert.match(mail.text, /tenantBilling\.cancellationNoticeDays\.monthly: 0 → 14/);
            assert.match(mail.text, /tenantBilling\.cancellationNoticeDays\.yearly: 0 → 90/);
            assert.match(mail.text, /Source: /);
            // A mail lists what moved and nothing else: the plan list is not in it.
            assert.doesNotMatch(mail.text, /PRO/);
        }
        assert.equal(port.changes.length, 1, 'the record is written whether or not mail goes out');
    });

    test('a boot that finds nothing changed mails nobody', async () => {
        const port = new FakeAppliedSettingsPort();
        const settings = settingsSubtreeOf(
            catalogWith({ notifications: { settingsChanged: ADDRESSES } }),
        );
        port.applied = {
            fingerprint: fingerprintOf(settings),
            settings,
            source: 'x',
            appliedAt: new Date('2026-08-01T06:00:00.000Z'),
        };
        const email = new FakeEmailPort();
        app = await boot(
            catalogWith({ notifications: { settingsChanged: ADDRESSES } }),
            port,
            email,
        );
        assert.deepEqual(email.sent, []);
    });

    test('the first boot has nothing to compare against, so it mails nobody', async () => {
        const email = new FakeEmailPort();
        app = await boot(
            catalogWith({ notifications: { settingsChanged: ADDRESSES } }),
            new FakeAppliedSettingsPort(),
            email,
        );
        assert.deepEqual(email.sent, []);
    });

    test('a mail that fails is logged, the others still go out, and the boot completes', async () => {
        const port = portWithAnOlderRecord();
        const email = new FakeEmailPort(['ops@example.com']);
        const { said } = await capturingLogs(async () => {
            app = await boot(
                catalogWith({ notifications: { settingsChanged: ADDRESSES } }),
                port,
                email,
            );
        });
        assert.deepEqual(
            email.sent.map((m) => m.to),
            ['cfo@example.com'],
        );
        assert.ok(
            said.error.some((line) => /ops@example\.com could not be sent/.test(line)),
            said.error,
        );
        assert.equal(port.changes.length, 1);
    });

    test('the boot log says once that changes are mailed', async () => {
        const { said } = await capturingLogs(async () => {
            app = await boot(
                catalogWith({ notifications: { settingsChanged: ADDRESSES } }),
                new FakeAppliedSettingsPort(),
                new FakeEmailPort(),
            );
        });
        const lines = said.log.filter((line) =>
            /Settings changes are mailed to 2 address/.test(line),
        );
        assert.equal(lines.length, 1, said.log);
    });
});

// @requirement SC-CFG-009 — A configuration change is noticed and reported
// @requirement SC-CFG-030 — Mail reaches nobody silently
describe('addresses in the file and no email port', () => {
    test('the change is recorded, nobody is mailed, and the boot log says so once', async () => {
        const port = portWithAnOlderRecord();
        const { said } = await capturingLogs(async () => {
            app = await boot(
                catalogWith({ notifications: { settingsChanged: ADDRESSES } }),
                port,
                null,
            );
        });
        assert.equal(port.changes.length, 1);
        const lines = said.warn.filter((line) => /no email port is bound/.test(line));
        assert.equal(lines.length, 1, said.warn);
        assert.match(lines[0], /notifications\.settingsChanged names 2 address/);
        assert.match(lines[0], /adapters\.email/);
    });
});

// @requirement SC-CFG-030 — Mail reaches nobody silently
describe('nobody named in the file', () => {
    test('is in-app only by choice: recorded, nothing mailed, nothing said about mail', async () => {
        const port = portWithAnOlderRecord();
        const email = new FakeEmailPort();
        const { said } = await capturingLogs(async () => {
            app = await boot(catalogWith(), port, email);
        });
        assert.equal(port.changes.length, 1);
        assert.deepEqual(email.sent, []);
        assert.deepEqual(
            [...said.warn, ...said.log].filter((line) => /mail/i.test(line)),
            [],
            'a correct configuration is not warned about',
        );
    });
});
