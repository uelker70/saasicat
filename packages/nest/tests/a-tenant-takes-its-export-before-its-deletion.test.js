// A tenant whose subscription ended takes its full export before its data is
// deleted (`SC-PRIV-019`): its administrator downloads it from
// `GET billing/export`, the application hands the file over through
// `TenantDataExportPort`, and every download is recorded beside the end before
// the file is sent — the tenant's acknowledgement `SC-PRIV-017` names.
//
// The order is what the record proves, so each step is broken on its own: the
// application failing records nothing, a record that cannot be written sends
// nothing. The tenant is always the session's: whatever else the request
// carries, the application is asked for that tenant alone.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import {
    ConflictException,
    ForbiddenException,
    Logger,
    ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { PLATFORM_CORE_MANIFEST_CONTRIBUTION } from '../dist/admin/index.js';
import {
    ComposedTenantAuthGuard,
    TenantAccessStateController,
    TenantAdminGuard,
    TenantDataExportController,
    TenantDataExportService,
} from '../dist/billing/index.js';
import { TENANT_ACCESS_MARK_KEY, TenantAccessService } from '../dist/index.js';
import {
    FakeSubscriptionEndRepository,
    FakeTenantAccessHoldRepository,
} from '../dist/testing/index.js';

const ENDED = new Date('2026-11-30T23:00:00.000Z');
const DELETES_ON = '2026-12-31';
const NOW = new Date('2026-12-05T10:00:00.000Z');
const LATER = new Date('2026-12-06T10:00:00.000Z');
/** The day after the deletion day, before anything deleted the data. */
const AFTER_THE_DELETION_DAY = new Date('2027-01-01T10:00:00.000Z');

/** Who takes the export, as the session describes them. */
const ACTOR = {
    userId: 'u-1',
    email: 'admin@acme.example',
    source: 'web',
    context: 's-1',
};

const FILE = {
    content: new TextEncoder().encode('{"notes":[]}'),
    mediaType: 'application/json',
    fileName: 'acme-export.json',
};

/** The application's export, recording which tenant it was asked for. */
function exportPort(answer = async () => FILE) {
    const askedFor = [];
    return {
        askedFor,
        export: async (tenantId) => {
            askedFor.push(tenantId);
            return answer(tenantId);
        },
    };
}

/** Records the reason `kind` for `tenantId`: an ended subscription names `sub-<tenant>`. */
const held = (holds, tenantId, kind) =>
    holds.record({
        tenantId,
        kind,
        reference: kind === 'ended' ? `sub-${tenantId}` : kind === 'overdue' ? 'inv-1' : null,
        note: null,
        since: ENDED,
        recordedBy: 'job:platform:subscription-ends',
    });

/** Records the end of `tenantId`'s subscription, with its deletion day. */
const ended = (ends, tenantId, overrides = {}) =>
    ends.record({
        tenantId,
        subscriptionId: `sub-${tenantId}`,
        endsAt: ENDED,
        deletesOn: DELETES_ON,
        recordedAt: ENDED,
        recordedBy: 'job:platform:subscription-ends',
        ...overrides,
    });

/**
 * `t1` held back for `kinds`, its end recorded where `endRecorded`, and the
 * export, its route and the access check over them.
 */
async function installation({
    kinds = ['ended'],
    endRecorded = true,
    port = exportPort(),
    ends = new FakeSubscriptionEndRepository(),
    audit,
} = {}) {
    const holds = new FakeTenantAccessHoldRepository();
    for (const kind of kinds) await held(holds, 't1', kind);
    if (endRecorded) await ended(ends, 't1');
    const audited = [];
    const access = new TenantAccessService(holds, new Reflector());
    const service = new TenantDataExportService(
        ends,
        port,
        access,
        null,
        audit ?? { log: async (entry) => audited.push(entry) },
    );
    service.onModuleInit();
    const route = new TenantDataExportController(service, null, null, null, null);
    return { holds, ends, port, access, service, route, audited };
}

/** A request of a user of `tenantId` holding `role`. */
const asUser = (tenantId = 't1', role = 'TENANT_ADMIN', extra = {}) => ({
    method: 'GET',
    user: { tenantId, sub: 'u-1', email: `admin@${tenantId}.example`, role },
    headers: { 'x-session-id': 's-1' },
    ...extra,
});

/** An execution context for `request` to the export route. */
const exportContext = (request) => ({
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => TenantDataExportController.prototype.export,
    getClass: () => TenantDataExportController,
});

/** The bytes a streamable file sends. */
async function bytesOf(file) {
    const chunks = [];
    for await (const chunk of file.getStream()) chunks.push(chunk);
    return Buffer.concat(chunks);
}

const refusedWith = (type, code) => (error) =>
    error instanceof type && error.getResponse().code === code;

/** Logs nothing while `work` runs, and answers what it logged as errors. */
async function quietly(work) {
    const logged = [];
    const error = Logger.prototype.error;
    Logger.prototype.error = function (...args) {
        logged.push(args.join(' '));
    };
    try {
        await work();
    } finally {
        Logger.prototype.error = error;
    }
    return logged;
}

// @requirement SC-PRIV-019 — Once its subscription has ended, a tenant's administrator takes its full export
describe("a tenant's administrator takes its export once its subscription ended", () => {
    test('the file goes out as the application produced it, under its name', async () => {
        const { route } = await installation();

        const file = await route.export(asUser());

        assert.deepEqual(file.getHeaders(), {
            type: 'application/json',
            disposition: 'attachment; filename="acme-export.json"',
            length: FILE.content.byteLength,
        });
        assert.deepEqual(await bytesOf(file), Buffer.from(FILE.content));
    });

    test('the download is recorded beside the end, with the moment and who took it', async () => {
        const { service, ends } = await installation();

        await service.take('t1', ACTOR, NOW);

        assert.deepEqual(
            ends.downloads.map(({ id: _id, ...download }) => download),
            [
                {
                    tenantId: 't1',
                    subscriptionId: 'sub-t1',
                    downloadedAt: NOW,
                    downloadedBy: 'web:admin@acme.example:s-1',
                },
            ],
        );
    });

    test('and written to the audit log under a key the audit page can name', async () => {
        const { service, ends, audited } = await installation();

        await service.take('t1', ACTOR, NOW);

        assert.deepEqual(audited, [
            {
                actor: ACTOR,
                entity: 'Tenant',
                entityId: 't1',
                action: 'TENANT_EXPORT_DOWNLOAD',
                changes: {
                    subscriptionId: 'sub-t1',
                    downloadId: ends.downloads[0].id,
                    mediaType: 'application/json',
                    bytes: FILE.content.byteLength,
                },
            },
        ]);
        const declared = PLATFORM_CORE_MANIFEST_CONTRIBUTION.audit.actions.find(
            ({ key }) => key === 'TENANT_EXPORT_DOWNLOAD',
        );
        assert.ok(declared?.label, 'the audit page can name it');
    });

    test('the route records who took it from the session', async () => {
        const { route, ends } = await installation();

        await route.export(asUser());

        assert.equal(ends.downloads[0].downloadedBy, 'web:admin@t1.example:s-1');
    });

    test('every download is a record of its own, the oldest first', async () => {
        const { service, ends } = await installation();

        await service.take('t1', ACTOR, LATER);
        await service.take('t1', ACTOR, NOW);

        assert.deepEqual(
            (await ends.listExportDownloadsFor(['sub-t1'])).map((d) => d.downloadedAt),
            [NOW, LATER],
        );
    });

    test('the application is asked again for every download', async () => {
        const { service, port } = await installation();

        await service.take('t1', ACTOR, NOW);
        await service.take('t1', ACTOR, LATER);

        assert.deepEqual(port.askedFor, ['t1', 't1']);
    });

    test('is still offered after the deletion day, while the data is there', async () => {
        const { service, ends } = await installation();

        assert.equal(await service.take('t1', ACTOR, AFTER_THE_DELETION_DAY), FILE);
        assert.equal(ends.downloads.length, 1);
    });

    test('of two ended subscriptions, the latest end is the one the download is recorded for', async () => {
        // The earlier end is recorded first and its subscription sorts first,
        // so whichever order a store reads the ends in — the order they were
        // written, or by subscription — the earlier one comes first, and only
        // choosing by the end itself names the latest.
        const ends = new FakeSubscriptionEndRepository();
        const { holds, service } = await installation({ ends, kinds: [], endRecorded: false });
        const EARLIER = new Date('2026-06-30T22:00:00.000Z');
        for (const [subscriptionId, endsAt] of [
            ['sub-t1-a', EARLIER],
            ['sub-t1-b', ENDED],
        ]) {
            await holds.record({
                tenantId: 't1',
                kind: 'ended',
                reference: subscriptionId,
                note: null,
                since: endsAt,
                recordedBy: 'job:platform:subscription-ends',
            });
            await ended(ends, 't1', { subscriptionId, endsAt });
        }

        await service.take('t1', ACTOR, NOW);

        assert.equal(ends.downloads[0].subscriptionId, 'sub-t1-b');
    });
});

// @requirement SC-PRIV-019 — Once its subscription has ended, a tenant's administrator takes its full export
describe('the export is offered only once an end is recorded', () => {
    test('a tenant that is open is refused, and the application is not asked', async () => {
        const { route, port, ends } = await installation({ kinds: [], endRecorded: false });

        await assert.rejects(
            route.export(asUser()),
            refusedWith(ConflictException, 'TENANT_EXPORT_NOT_OFFERED'),
        );
        assert.deepEqual(port.askedFor, []);
        assert.deepEqual(ends.downloads, []);
    });

    test('a tenant read-only for an unpaid invoice, with no end, is refused', async () => {
        const { route, port } = await installation({ kinds: ['overdue'], endRecorded: false });

        await assert.rejects(
            route.export(asUser()),
            refusedWith(ConflictException, 'TENANT_EXPORT_NOT_OFFERED'),
        );
        assert.deepEqual(port.askedFor, []);
    });

    test('a tenant held for an ended subscription whose end is not recorded yet is refused', async () => {
        const { route, port } = await installation({ endRecorded: false });

        await assert.rejects(
            route.export(asUser()),
            refusedWith(ConflictException, 'TENANT_EXPORT_NOT_OFFERED'),
        );
        assert.deepEqual(port.askedFor, []);
    });

    test('an end whose reason was lifted offers nothing any more', async () => {
        const { route, holds, port } = await installation();
        await holds.lift(holds.holds[0].id, LATER, 'web:ops@example.com:s-9');

        await assert.rejects(
            route.export(asUser()),
            refusedWith(ConflictException, 'TENANT_EXPORT_NOT_OFFERED'),
        );
        assert.deepEqual(port.askedFor, []);
    });
});

// @requirement SC-PRIV-019 — Once its subscription has ended, a tenant's administrator takes its full export
describe('a file never leaves without its record, and no record claims a file not produced', () => {
    test('an application that fails is refused with a stable code, and nothing is recorded', async () => {
        const port = exportPort(async () => {
            throw new Error('the export query timed out');
        });
        const { route, ends, audited } = await installation({ port });

        const logged = await quietly(() =>
            assert.rejects(
                route.export(asUser()),
                refusedWith(ServiceUnavailableException, 'TENANT_EXPORT_FAILED'),
            ),
        );

        assert.deepEqual(ends.downloads, []);
        assert.deepEqual(audited, []);
        assert.equal(logged.length, 1, 'the failure is in the server log');
    });

    test('an answer whose content is not bytes is refused, and nothing is recorded', async () => {
        const port = exportPort(async () => ({ ...FILE, content: '{"notes":[]}' }));
        const { route, ends } = await installation({ port });

        await quietly(() =>
            assert.rejects(
                route.export(asUser()),
                refusedWith(ServiceUnavailableException, 'TENANT_EXPORT_FAILED'),
            ),
        );
        assert.deepEqual(ends.downloads, []);
    });

    test('a media type a header cannot carry is refused before anything is recorded', async () => {
        const port = exportPort(async () => ({
            ...FILE,
            mediaType: 'application/json\r\nSet-Cookie: session=x',
        }));
        const { route, ends } = await installation({ port });

        await quietly(() =>
            assert.rejects(
                route.export(asUser()),
                refusedWith(ServiceUnavailableException, 'TENANT_EXPORT_FAILED'),
            ),
        );
        assert.deepEqual(ends.downloads, []);
    });

    test('an answer without a file name is refused, and nothing is recorded', async () => {
        const port = exportPort(async () => ({ content: FILE.content, mediaType: 'text/plain' }));
        const { route, ends } = await installation({ port });

        await quietly(() =>
            assert.rejects(
                route.export(asUser()),
                refusedWith(ServiceUnavailableException, 'TENANT_EXPORT_FAILED'),
            ),
        );
        assert.deepEqual(ends.downloads, []);
    });

    test('a download that cannot be recorded sends no file and writes no audit entry', async () => {
        const ends = new FakeSubscriptionEndRepository();
        ends.recordExportDownload = async () => {
            throw new Error('the database is unreachable');
        };
        const { route, audited } = await installation({ ends });

        await assert.rejects(route.export(asUser()), /the database is unreachable/);
        assert.deepEqual(audited, []);
    });

    test('an audit log that fails leaves the download recorded and sent', async () => {
        const audit = {
            log: async () => {
                throw new Error('the audit log is unreachable');
            },
        };
        const { route, ends } = await installation({ audit });

        let file;
        const logged = await quietly(async () => {
            file = await route.export(asUser());
        });

        assert.equal(file.getHeaders().length, FILE.content.byteLength);
        assert.equal(ends.downloads.length, 1);
        assert.equal(logged.length, 1, 'the missing entry is in the server log');
    });
});

// @requirement SC-PRIV-019 — Once its subscription has ended, a tenant's administrator takes its full export
describe("the export is the session's tenant's alone", () => {
    test('a request naming another tenant anywhere but its session is answered for its session', async () => {
        const { route, port } = await installation();

        await assert.rejects(
            route.export(
                asUser('t2', 'TENANT_ADMIN', {
                    params: { tenantId: 't1' },
                    query: { tenantId: 't1' },
                    body: { tenantId: 't1' },
                }),
            ),
            refusedWith(ConflictException, 'TENANT_EXPORT_NOT_OFFERED'),
            "t2 holds no ended reason of its own, so t1's end offers it nothing",
        );
        assert.deepEqual(port.askedFor, [], 'the application is never asked for t1');
    });

    test("another tenant's end, recorded under a reason of its own, offers its own export only", async () => {
        const ends = new FakeSubscriptionEndRepository();
        const { holds, route, port } = await installation({ ends });
        await held(holds, 't2', 'ended');
        await ended(ends, 't2');

        await route.export(asUser('t2', 'TENANT_ADMIN', { query: { tenantId: 't1' } }));

        assert.deepEqual(port.askedFor, ['t2']);
        assert.deepEqual(
            ends.downloads.map((d) => [d.tenantId, d.subscriptionId]),
            [['t2', 'sub-t2']],
        );
    });

    test("a reason naming another tenant's subscription offers nothing", async () => {
        const ends = new FakeSubscriptionEndRepository();
        const { holds, route, port } = await installation({ ends, kinds: [] });
        await holds.record({
            tenantId: 't2',
            kind: 'ended',
            reference: 'sub-t1',
            note: null,
            since: ENDED,
            recordedBy: 'job:platform:subscription-ends',
        });

        await assert.rejects(
            route.export(asUser('t2')),
            refusedWith(ConflictException, 'TENANT_EXPORT_NOT_OFFERED'),
        );
        assert.deepEqual(port.askedFor, []);
    });
});

// @requirement SC-PRIV-019 — Once its subscription has ended, a tenant's administrator takes its full export
describe('the file name the application gives is not trusted for the header', () => {
    test('path separators, quotes and line breaks are replaced', async () => {
        const port = exportPort(async () => ({
            ...FILE,
            fileName: '../../etc/acme"\r\nSet-Cookie: x.json',
        }));
        const { route } = await installation({ port });

        const file = await route.export(asUser());

        assert.equal(
            file.getHeaders().disposition,
            'attachment; filename=".._.._etc_acme___Set-Cookie__x.json"',
        );
    });

    test('an empty name is offered as the export', async () => {
        const port = exportPort(async () => ({ ...FILE, fileName: '' }));
        const { route } = await installation({ port });

        const file = await route.export(asUser());

        assert.equal(file.getHeaders().disposition, 'attachment; filename="export"');
    });
});

// @requirement SC-PRIV-019 — Once its subscription has ended, a tenant's administrator takes its full export
describe('where the route is checked', () => {
    test('it carries no access mark, so a read-only tenant reads it as a GET', () => {
        const route = TenantDataExportController.prototype.export;
        assert.equal(Reflect.getMetadata(TENANT_ACCESS_MARK_KEY, route), undefined);
        assert.equal(
            Reflect.getMetadata(TENANT_ACCESS_MARK_KEY, TenantDataExportController),
            undefined,
        );
    });

    test("it stays behind the tenant's guard and the administrator's", () => {
        assert.deepEqual(Reflect.getMetadata('__guards__', TenantDataExportController), [
            ComposedTenantAuthGuard,
        ]);
        assert.deepEqual(
            Reflect.getMetadata('__guards__', TenantDataExportController.prototype.export),
            [TenantAdminGuard],
        );
    });

    test('a user of the tenant without the role is refused; the administrator and the operator acting are let through', () => {
        const guard = new TenantAdminGuard();
        assert.throws(
            () => guard.canActivate(exportContext(asUser('t1', 'USER'))),
            refusedWith(ForbiddenException, 'TENANT_ADMIN_REQUIRED'),
        );
        assert.equal(guard.canActivate(exportContext(asUser('t1', 'TENANT_ADMIN'))), true);
        assert.equal(guard.canActivate(exportContext(asUser('t1', 'SUPER_ADMIN'))), true);
    });

    test('a tenant read-only because its subscription ended is let through', async () => {
        const { access } = await installation();
        await access.enforce(exportContext(asUser()), 't1');
    });

    test('a tenant whose subscription ended and that is suspended is refused', async () => {
        const { access } = await installation({ kinds: ['ended', 'suspended'] });
        await assert.rejects(
            access.enforce(exportContext(asUser()), 't1'),
            refusedWith(ForbiddenException, 'TENANT_SUSPENDED'),
        );
    });

    test('a tenant whose subscription ended and that is being deleted is refused', async () => {
        const { access } = await installation({ kinds: ['ended', 'deleting'] });
        await assert.rejects(
            access.enforce(exportContext(asUser()), 't1'),
            refusedWith(ForbiddenException, 'TENANT_BEING_DELETED'),
        );
    });
});

// @requirement SC-PRIV-019 — Once its subscription has ended, a tenant's administrator takes its full export
describe('the state a user reads offers the export exactly where the route serves it', () => {
    const STATES = {
        open: { kinds: [], endRecorded: false },
        'read-only for an unpaid invoice': { kinds: ['overdue'], endRecorded: false },
        'ended, its end not recorded yet': { kinds: ['ended'], endRecorded: false },
        ended: { kinds: ['ended'], endRecorded: true },
        'ended and overdue': { kinds: ['ended', 'overdue'], endRecorded: true },
        'ended and suspended': { kinds: ['ended', 'suspended'], endRecorded: true },
        'ended and being deleted': { kinds: ['ended', 'deleting'], endRecorded: true },
    };

    /** Whether the route hands `request` the file: the access check, the guard, the service. */
    async function served(setup, request) {
        try {
            await setup.access.enforce(exportContext(request), 't1');
            new TenantAdminGuard().canActivate(exportContext(request));
            await setup.route.export(request);
            return true;
        } catch {
            return false;
        }
    }

    test('for the administrator, offered where it is served and nowhere else', async () => {
        const offered = [];
        for (const [state, given] of Object.entries(STATES)) {
            const setup = await installation(given);
            const view = await new TenantAccessStateController(null, null, setup.access).state(
                asUser(),
            );
            assert.equal(view.mayExport, await served(setup, asUser()), state);
            if (view.mayExport) offered.push(state);
        }
        assert.deepEqual(offered, ['ended', 'ended and overdue']);
    });

    test('for a user without the role, offered nowhere, and served nowhere', async () => {
        for (const [state, given] of Object.entries(STATES)) {
            const setup = await installation(given);
            const view = await new TenantAccessStateController(null, null, setup.access).state(
                asUser('t1', 'USER'),
            );
            assert.equal(view.mayExport, false, state);
            assert.equal(await served(setup, asUser('t1', 'USER')), false, state);
        }
    });

    test('where the application wired no export, nothing is offered', async () => {
        const holds = new FakeTenantAccessHoldRepository();
        await held(holds, 't1', 'ended');
        const access = new TenantAccessService(holds, new Reflector());

        const view = await new TenantAccessStateController(null, null, access).state(asUser());

        assert.equal(view.state, 'read-only');
        assert.equal(view.mayExport, false);
    });
});
