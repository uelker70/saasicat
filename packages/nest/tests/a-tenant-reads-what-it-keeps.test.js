// What a tenant in its read-only period keeps for obligations of its own
// (`SC-PRIV-022`), read from `GET billing/access/keep` by every user of the
// tenant, once a page loads rather than with every read of its state: each
// read asks the application, which may answer slowly, wrongly or not at all.
// Then the users are shown no lines and nothing else changes — the lines never
// hold up the banner, nor the deletion.
//
// The tenant is the session's: whatever the request carries, the application
// is asked for that tenant alone, and no other tenant's lines are answered.

import { afterEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
    ComposedTenantAuthGuard,
    KEEP_REPORT_READ_TIMEOUT_MS,
    TenantBillingModule,
    TenantKeepController,
    TenantKeepReadingService,
} from '../dist/billing/index.js';
import { TENANT_ACCESS_MARK_KEY, TenantAccessService } from '../dist/index.js';
import {
    FakeSubscriptionEndRepository,
    FakeTenantAccessHoldRepository,
} from '../dist/testing/index.js';
import { aHandWiredDeletion } from './helpers/installation-mark.js';
import { aQuietLogger } from './helpers/tenant-deletion.js';
import { anExport } from './helpers/tenant-data-export.js';
import { noticeRecord, sendingPort } from './helpers/version-notices.js';

afterEach(() => mock.timers.reset());

const SINCE = new Date('2026-11-30T23:00:00.000Z');

/** What each tenant keeps, as the application reports it. */
const LINES = {
    t1: [
        { category: 'receipts', count: 412, labels: { en: 'Receipts', de: 'Belege' } },
        { category: 'contracts', count: 37, labels: { en: 'Sales contracts' } },
    ],
    t2: [{ category: 'payslips', count: 9, labels: { en: 'Payslips' } }],
};

/** The application's report, answering `answer(tenantId)` and noting whom it was asked for. */
function aReport(answer = async (tenantId) => LINES[tenantId] ?? []) {
    const askedFor = [];
    return {
        askedFor,
        keep: (tenantId) => {
            askedFor.push(tenantId);
            return answer(tenantId);
        },
    };
}

/** Records the reason `kind` for `tenantId`. */
const held = (holds, tenantId, kind) =>
    holds.record({
        tenantId,
        kind,
        reference: kind === 'ended' ? `sub-${tenantId}` : kind === 'overdue' ? 'inv-1' : null,
        note: null,
        since: SINCE,
        recordedBy: 'job:platform:subscription-ends',
    });

/** Both tenants held back for `kinds`, and the route over them. */
async function installation({ kinds = ['ended'], report = aReport() } = {}) {
    const holds = new FakeTenantAccessHoldRepository();
    for (const tenantId of ['t1', 't2']) {
        for (const kind of kinds) await held(holds, tenantId, kind);
    }
    const access = new TenantAccessService(holds, new Reflector());
    const reading = new TenantKeepReadingService(report, access);
    const logger = aQuietLogger();
    reading.logger = logger;
    const route = new TenantKeepController(reading, null);
    return { access, report, route, said: logger.said };
}

/** A request of a user of `tenantId` holding `role`. */
const asUser = (tenantId = 't1', role = 'USER', extra = {}) => ({
    method: 'GET',
    user: { tenantId, sub: 'u-1', email: `someone@${tenantId}.example`, role },
    headers: {},
    ...extra,
});

/** An execution context for `request` to the route. */
const keepContext = (request) => ({
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => TenantKeepController.prototype.keep,
    getClass: () => TenantKeepController,
});

const refusedWith = (code) => (error) =>
    error instanceof ForbiddenException && error.getResponse().code === code;

/** Lets every promise that can move on now do so. */
async function ticks(count = 10) {
    for (let at = 0; at < count; at++) await new Promise((resolve) => setImmediate(resolve));
}

// @requirement SC-PRIV-022 — A tenant is erased by the application's stores, after it was told what to keep
describe('a tenant in its read-only period reads what it keeps', () => {
    test('every user of the tenant is answered the lines as the application reported them', async () => {
        const { route, report } = await installation();

        assert.deepEqual(await route.keep(asUser()), { keep: LINES.t1 });
        assert.deepEqual(report.askedFor, ['t1']);
    });

    test('the tenant is the session’s: one named by the request is neither asked for nor answered', async () => {
        const { route, report } = await installation();
        const request = asUser('t1', 'USER', {
            query: { tenantId: 't2' },
            params: { tenantId: 't2' },
            headers: { 'x-tenant-id': 't2' },
        });

        assert.deepEqual(await route.keep(request), { keep: LINES.t1 });
        assert.deepEqual(report.askedFor, ['t1']);
    });

    test('an open tenant keeps nothing to be told of, and the application is not asked', async () => {
        const { route, report } = await installation({ kinds: [] });

        assert.deepEqual(await route.keep(asUser()), { keep: [] });
        assert.deepEqual(report.askedFor, []);
    });

    test('a tenant read-only for an unpaid invoice alone is not being deleted: nothing, unasked', async () => {
        const { route, report } = await installation({ kinds: ['overdue'] });

        assert.deepEqual(await route.keep(asUser()), { keep: [] });
        assert.deepEqual(report.askedFor, []);
    });

    test('an ended subscription beside an unpaid invoice is asked for', async () => {
        const { route } = await installation({ kinds: ['overdue', 'ended'] });

        assert.deepEqual(await route.keep(asUser()), { keep: LINES.t1 });
    });
});

// @requirement SC-PRIV-022 — A tenant is erased by the application's stores, after it was told what to keep
describe('what the application fails to answer is shown as no lines, and said in the log', () => {
    test('a report that throws: no lines, a sentence with its code, nothing of what it threw', async () => {
        const report = aReport(async () => {
            throw new Error('database down for Autohaus Müller');
        });
        const { route, said } = await installation({ report });

        assert.deepEqual(await route.keep(asUser()), { keep: null });
        assert.equal(said.warn.length, 1);
        assert.match(said.warn[0], /\bt1\b/);
        assert.match(said.warn[0], /\(failed\)/);
        assert.doesNotMatch(said.warn[0], /Müller|database/);
    });

    test('lines without their English label: no lines, a sentence with the problem, no label', async () => {
        const report = aReport(async () => [
            { category: 'receipts', count: 412, labels: { de: 'Belege' } },
        ]);
        const { route, said } = await installation({ report });

        assert.deepEqual(await route.keep(asUser()), { keep: null });
        assert.equal(said.warn.length, 1);
        assert.match(said.warn[0], /\(labels\)/);
        assert.doesNotMatch(said.warn[0], /Belege/);
    });

    test('an answer that is no list at all: no lines', async () => {
        const report = aReport(async () => ({ receipts: 412 }));
        const { route, said } = await installation({ report });

        assert.deepEqual(await route.keep(asUser()), { keep: null });
        assert.match(said.warn[0], /\(not-a-list\)/);
    });

    test('a report that never answers is given up on after the time allowed', async () => {
        mock.timers.enable({ apis: ['setTimeout'] });
        const report = aReport(() => new Promise(() => {}));
        const { route, said } = await installation({ report });
        const outcome = { settled: false, value: undefined };
        void route.keep(asUser()).then((value) => Object.assign(outcome, { settled: true, value }));
        await ticks();

        mock.timers.tick(KEEP_REPORT_READ_TIMEOUT_MS - 1);
        await ticks();
        assert.equal(outcome.settled, false, 'waits for the time allowed');

        mock.timers.tick(1);
        await ticks();
        assert.equal(outcome.settled, true, 'answers once the time allowed has passed');
        assert.deepEqual(outcome.value, { keep: null });
        assert.match(said.warn[0], /\(timeout\)/);
    });

    test('the time allowed is short enough for a page to wait on', () => {
        assert.ok(KEEP_REPORT_READ_TIMEOUT_MS <= 10_000, String(KEEP_REPORT_READ_TIMEOUT_MS));
    });
});

// @requirement SC-PRIV-022 — A tenant is erased by the application's stores, after it was told what to keep
describe('where the route is checked', () => {
    test('it carries no access mark: the tenant’s state decides, as for every read', () => {
        assert.equal(
            Reflect.getMetadata(TENANT_ACCESS_MARK_KEY, TenantKeepController.prototype.keep),
            undefined,
        );
        assert.equal(Reflect.getMetadata(TENANT_ACCESS_MARK_KEY, TenantKeepController), undefined);
    });

    test('it stays behind the tenant’s guard, and asks no role of the tenant’s user', () => {
        assert.deepEqual(Reflect.getMetadata('__guards__', TenantKeepController), [
            ComposedTenantAuthGuard,
        ]);
        assert.equal(
            Reflect.getMetadata('__guards__', TenantKeepController.prototype.keep),
            undefined,
        );
    });

    test('a read-only tenant’s user without any role is let through', async () => {
        const { access } = await installation();
        await access.enforce(keepContext(asUser('t1', 'USER')), 't1');
    });

    test('a suspended tenant is refused, as on every route but its state', async () => {
        const { access } = await installation({ kinds: ['ended', 'suspended'] });
        await assert.rejects(
            access.enforce(keepContext(asUser()), 't1'),
            refusedWith('TENANT_SUSPENDED'),
        );
    });

    test('a tenant being deleted is refused', async () => {
        const { access } = await installation({ kinds: ['ended', 'deleting'] });
        await assert.rejects(
            access.enforce(keepContext(asUser()), 't1'),
            refusedWith('TENANT_BEING_DELETED'),
        );
    });
});

// @requirement SC-PRIV-022 — A tenant is erased by the application's stores, after it was told what to keep
describe('where the route is mounted', () => {
    const WITHOUT_ENDS = {
        authGuards: [class Guard {}],
        subscriptionUsagePort: {},
        usageSnapshotPort: {},
        subscriptionWritePort: {},
        notices: { port: sendingPort(), record: noticeRecord() },
    };

    test('beside the deletion of tenants', () => {
        const module = TenantBillingModule.forRoot({
            ...WITHOUT_ENDS,
            subscriptionEnds: {
                store: new FakeSubscriptionEndRepository(),
                export: anExport(),
                deletion: aHandWiredDeletion(),
            },
        });

        assert.ok(module.controllers.includes(TenantKeepController));
        assert.ok(module.providers.includes(TenantKeepReadingService));
    });

    test('nowhere a subscription’s end is kept', () => {
        const module = TenantBillingModule.forRoot(WITHOUT_ENDS);

        assert.ok(!module.controllers.includes(TenantKeepController));
        assert.ok(!module.providers.includes(TenantKeepReadingService));
    });
});
