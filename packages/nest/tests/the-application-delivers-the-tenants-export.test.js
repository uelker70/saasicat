// A tenant's full export that the application delivers itself (`SC-PRIV-020`).
// `subscriptionEnds.export` declares `{ deliveredBy: 'application' }`, the
// application streams the file from a download of its own, and once the whole
// file has gone out it calls `TenantExportDeliveryService.recordDelivered`.
// The platform records the download beside the end and audits it exactly as
// one it served, by the same rules of who and when; where one does not hold it
// refuses with a stable code and records nothing, and the application keeps
// its own trace.
//
// The record is the tenant's acknowledgement (`SC-PRIV-017`), so each rule is
// broken on its own, and each refusal is shown to leave nothing behind.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import {
    ConflictException,
    ForbiddenException,
    Logger,
    MethodNotAllowedException,
    NotFoundException,
    ServiceUnavailableException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AdminResourcesService } from '../dist/admin/index.js';
import {
    TenantAccessStateController,
    TenantDataExportService,
    TenantExportDeliveryService,
    TenantInvoicesController,
} from '../dist/billing/index.js';
import { TenantAccessService } from '../dist/index.js';
import {
    FakeSubscriptionEndRepository,
    FakeTenantAccessHoldRepository,
} from '../dist/testing/index.js';
import { BYPASS, FRAMES, codeOf, visibleTo } from './helpers/row-level-policy.js';

const ENDED = new Date('2026-11-30T23:00:00.000Z');
const NOW = new Date('2026-12-05T10:00:00.000Z');
const LATER = new Date('2026-12-06T10:00:00.000Z');
/** The day after the deletion day, before anything deleted the data. */
const AFTER_THE_DELETION_DAY = new Date('2027-01-01T10:00:00.000Z');

/** A full export of the size an application streams: more bytes than 32 bits count. */
const DELIVERED = { size: 250 * 1024 ** 3, mediaType: 'application/zip' };

/** Records the reason `kind` for `tenantId`: an ended subscription names `sub-<tenant>`. */
const holdFor = (holds, tenantId, kind) =>
    holds.record({
        tenantId,
        kind,
        reference: kind === 'ended' ? `sub-${tenantId}` : kind === 'overdue' ? 'inv-1' : null,
        note: null,
        since: ENDED,
        recordedBy: 'job:platform:subscription-ends',
    });

/** Records the end of `tenantId`'s subscription `subscriptionId`, ending at `endsAt`. */
const endOf = (ends, tenantId, { subscriptionId = `sub-${tenantId}`, endsAt = ENDED } = {}) =>
    ends.record({
        tenantId,
        subscriptionId,
        endsAt,
        deletesOn: '2026-12-31',
        recordedAt: endsAt,
        recordedBy: 'job:platform:subscription-ends',
    });

/**
 * `t1` held back for `kinds`, its end recorded where `endRecorded`, and the
 * application's delivery over them, the way `SaaSiCatModule` composes it
 * where the application declares that it delivers the export.
 */
async function delivering({
    kinds = ['ended'],
    endRecorded = true,
    ends = new FakeSubscriptionEndRepository(),
    holds = new FakeTenantAccessHoldRepository(),
    bypass = null,
    audit,
} = {}) {
    for (const kind of kinds) await holdFor(holds, 't1', kind);
    if (endRecorded) await endOf(ends, 't1');
    const audited = [];
    const access = new TenantAccessService(holds, new Reflector(), bypass);
    const delivery = new TenantExportDeliveryService(
        ends,
        access,
        bypass,
        audit ?? { log: async (entry) => audited.push(entry) },
    );
    delivery.onModuleInit();
    return { holds, ends, access, delivery, audited };
}

/** The request the application served its download on, by a user of `tenantId` holding `role`. */
const servedTo = (tenantId = 't1', role = 'TENANT_ADMIN', extra = {}) => ({
    method: 'GET',
    user: { tenantId, sub: 'u-1', email: `admin@${tenantId}.example`, role },
    headers: { 'x-session-id': 's-1' },
    ...extra,
});

const refusedWith = (type, code) => (error) =>
    error instanceof type && error.getResponse().code === code;

/** Logs nothing while `work` runs, and answers how many errors it logged. */
async function errorsLoggedBy(work) {
    let count = 0;
    const error = Logger.prototype.error;
    Logger.prototype.error = () => {
        count += 1;
    };
    try {
        await work();
    } finally {
        Logger.prototype.error = error;
    }
    return count;
}

// @requirement SC-PRIV-020 — A tenant's administrator takes its full export, from the platform or the application
describe('the application records a download it delivered in full', () => {
    test('it is recorded beside the end, with the moment, who took it from the session and the bytes that went out', async () => {
        const { delivery, ends } = await delivering();

        await delivery.recordDelivered(servedTo(), DELIVERED, NOW);

        assert.deepEqual(
            ends.downloads.map(({ id: _id, ...download }) => download),
            [
                {
                    tenantId: 't1',
                    subscriptionId: 'sub-t1',
                    downloadedAt: NOW,
                    downloadedBy: 'web:admin@t1.example:s-1',
                    downloadedByUserId: 'u-1',
                    size: DELIVERED.size,
                },
            ],
        );
    });

    test('the application is answered the download as recorded', async () => {
        const { delivery, ends } = await delivering();

        const download = await delivery.recordDelivered(servedTo(), DELIVERED, NOW);

        assert.deepEqual(download, ends.downloads[0]);
    });

    test('and written to the audit log as a download the platform serves is', async () => {
        const { delivery, ends, audited } = await delivering();

        await delivery.recordDelivered(servedTo(), DELIVERED, NOW);

        assert.deepEqual(audited, [
            {
                actor: {
                    userId: 'u-1',
                    email: 'admin@t1.example',
                    source: 'web',
                    context: 's-1',
                },
                entity: 'Tenant',
                entityId: 't1',
                action: 'TENANT_EXPORT_DOWNLOAD',
                changes: {
                    subscriptionId: 'sub-t1',
                    downloadId: ends.downloads[0].id,
                    mediaType: 'application/zip',
                    bytes: DELIVERED.size,
                },
            },
        ]);
    });

    test('every delivery is a record of its own, the oldest first', async () => {
        const { delivery, ends } = await delivering();

        await delivery.recordDelivered(servedTo(), DELIVERED, LATER);
        await delivery.recordDelivered(servedTo(), DELIVERED, NOW);

        assert.deepEqual(
            (await ends.listExportDownloadsFor(['sub-t1'])).map((d) => d.downloadedAt),
            [NOW, LATER],
        );
    });

    test('is still recorded after the deletion day, while the data is there', async () => {
        const { delivery, ends } = await delivering();

        await delivery.recordDelivered(servedTo(), DELIVERED, AFTER_THE_DELETION_DAY);

        assert.equal(ends.downloads.length, 1);
    });

    test('of two ended subscriptions, the latest end is the one the download is recorded for', async () => {
        const ends = new FakeSubscriptionEndRepository();
        const holds = new FakeTenantAccessHoldRepository();
        await endOf(ends, 't1', { subscriptionId: 'sub-a', endsAt: ENDED });
        await endOf(ends, 't1', { subscriptionId: 'sub-b', endsAt: new Date('2026-12-02') });
        for (const reference of ['sub-b', 'sub-a']) {
            await holds.record({
                tenantId: 't1',
                kind: 'ended',
                reference,
                note: null,
                since: ENDED,
                recordedBy: 'job:platform:subscription-ends',
            });
        }
        const { delivery } = await delivering({ kinds: [], endRecorded: false, ends, holds });

        await delivery.recordDelivered(servedTo(), DELIVERED, NOW);

        assert.deepEqual(
            ends.downloads.map((d) => d.subscriptionId),
            ['sub-b'],
        );
    });

    test('one at a time is the application’s to keep: two deliveries reported together are both recorded', async () => {
        const { delivery, ends } = await delivering();

        await Promise.all([
            delivery.recordDelivered(servedTo(), DELIVERED, NOW),
            delivery.recordDelivered(servedTo(), DELIVERED, NOW),
        ]);

        assert.equal(ends.downloads.length, 2);
    });

    test('an audit log that fails leaves the download recorded, and says so in the server log', async () => {
        const { delivery, ends } = await delivering({
            audit: {
                log: async () => {
                    throw new Error('the audit store is unreachable');
                },
            },
        });

        const logged = await errorsLoggedBy(() =>
            delivery.recordDelivered(servedTo(), DELIVERED, NOW),
        );

        assert.equal(ends.downloads.length, 1);
        assert.equal(logged, 1);
    });

    test('a download that cannot be recorded is thrown as it is, and writes no audit entry', async () => {
        const ends = new FakeSubscriptionEndRepository();
        ends.recordExportDownload = async () => {
            throw new Error('the database is unreachable');
        };
        const { delivery, audited } = await delivering({ ends });

        await assert.rejects(
            delivery.recordDelivered(servedTo(), DELIVERED, NOW),
            /the database is unreachable/,
        );
        assert.deepEqual(audited, []);
    });
});

// @requirement SC-PRIV-020 — A tenant's administrator takes its full export, from the platform or the application
describe('a delivery is recorded only once an end is recorded', () => {
    const NOT_OFFERED = {
        open: { kinds: [], endRecorded: false },
        'read-only for an unpaid invoice': { kinds: ['overdue'], endRecorded: false },
        'ended, its end not recorded yet': { kinds: ['ended'], endRecorded: false },
    };

    for (const [state, given] of Object.entries(NOT_OFFERED)) {
        test(`${state}: refused as not offered, and nothing is recorded or audited`, async () => {
            const { delivery, ends, audited } = await delivering(given);

            await assert.rejects(
                delivery.recordDelivered(servedTo(), DELIVERED, NOW),
                refusedWith(ConflictException, 'TENANT_EXPORT_NOT_OFFERED'),
            );
            assert.deepEqual(ends.downloads, []);
            assert.deepEqual(audited, []);
        });
    }

    test('an end whose reason was lifted records nothing any more', async () => {
        const { delivery, holds, ends } = await delivering();
        const [ended] = await holds.listOpen('t1');
        await holds.lift(ended.id, NOW, 'web:ops@example.com:s1');

        await assert.rejects(
            delivery.recordDelivered(servedTo(), DELIVERED, LATER),
            refusedWith(ConflictException, 'TENANT_EXPORT_NOT_OFFERED'),
        );
        assert.deepEqual(ends.downloads, []);
    });
});

// @requirement SC-PRIV-020 — A tenant's administrator takes its full export, from the platform or the application
describe('only a whole file is recorded', () => {
    test('one byte is a file, and is recorded', async () => {
        const { delivery, ends } = await delivering();

        await delivery.recordDelivered(servedTo(), { ...DELIVERED, size: 1 }, NOW);

        assert.deepEqual(
            ends.downloads.map((d) => d.size),
            [1],
        );
    });

    const NOT_A_FILE = {
        'no bytes': { ...DELIVERED, size: 0 },
        'fewer than none': { ...DELIVERED, size: -1 },
        'part of a byte': { ...DELIVERED, size: 1.5 },
        'a size that is not a number': { ...DELIVERED, size: Number.NaN },
        'a size beyond what is counted exactly': { ...DELIVERED, size: 2 ** 53 },
        'a size as text': { ...DELIVERED, size: '2048' },
        'no media type': { size: DELIVERED.size },
        'an empty media type': { ...DELIVERED, mediaType: '' },
        'a media type with a line break': { ...DELIVERED, mediaType: 'application/zip\r\nX: 1' },
        'a media type outside ASCII': { ...DELIVERED, mediaType: 'application/zip; name=ä' },
    };

    for (const [what, delivered] of Object.entries(NOT_A_FILE)) {
        test(`${what}: refused as an export not delivered, and nothing is recorded or audited`, async () => {
            const { delivery, ends, audited } = await delivering();

            const logged = await errorsLoggedBy(() =>
                assert.rejects(
                    delivery.recordDelivered(servedTo(), delivered, NOW),
                    refusedWith(ServiceUnavailableException, 'TENANT_EXPORT_FAILED'),
                ),
            );

            assert.deepEqual(ends.downloads, []);
            assert.deepEqual(audited, []);
            assert.equal(logged, 1, 'the server log says what was wrong');
        });
    }
});

// @requirement SC-PRIV-020 — A tenant's administrator takes its full export, from the platform or the application
describe('a HEAD carries no file, so it records nothing', () => {
    // Express and Fastify run the `GET` handler for it and drop the body, while
    // the response still takes the stream to the end: the size reported is the
    // whole file's, and the response has finished.
    for (const method of ['HEAD', 'head']) {
        test(`${method}: refused as the method the export is not taken by, and nothing is recorded or audited`, async () => {
            const { delivery, ends, audited } = await delivering();

            await assert.rejects(
                delivery.recordDelivered(
                    servedTo('t1', 'TENANT_ADMIN', { method }),
                    DELIVERED,
                    NOW,
                ),
                (error) => error instanceof MethodNotAllowedException,
            );
            assert.deepEqual(ends.downloads, []);
            assert.deepEqual(audited, []);
        });
    }
});

// @requirement SC-PRIV-020 — A tenant's administrator takes its full export, from the platform or the application
describe('the operator does not record a download in the tenant’s name', () => {
    test('a user holding SUPER_ADMIN is refused with a code of its own, and nothing is recorded', async () => {
        const { delivery, ends, audited } = await delivering();

        await assert.rejects(
            delivery.recordDelivered(servedTo('t1', 'SUPER_ADMIN'), DELIVERED, NOW),
            refusedWith(ForbiddenException, 'TENANT_EXPORT_NOT_FOR_OPERATOR'),
        );
        assert.deepEqual(ends.downloads, []);
        assert.deepEqual(audited, []);
    });

    test("the operator the application's check let through as acting is refused, whatever role the session carries", async () => {
        const { access, delivery, ends } = await delivering();
        const request = servedTo('t1', 'TENANT_ADMIN');
        await access.enforce(contextOf(request), 't1', { actingAsOperator: true });

        await assert.rejects(
            delivery.recordDelivered(request, DELIVERED, NOW),
            refusedWith(ForbiddenException, 'TENANT_EXPORT_NOT_FOR_OPERATOR'),
        );
        assert.deepEqual(ends.downloads, []);
    });

    test('a request the application checked as a tenant user’s is recorded as the administrator’s', async () => {
        const { access, delivery, ends } = await delivering();
        const request = servedTo('t1', 'TENANT_ADMIN');
        await access.enforce(contextOf(request), 't1', { actingAsOperator: false });

        await delivery.recordDelivered(request, DELIVERED, NOW);

        assert.equal(ends.downloads.length, 1);
    });

    test('a user of the tenant without the administrator’s role is refused, and nothing is recorded', async () => {
        const { delivery, ends } = await delivering();

        await assert.rejects(
            delivery.recordDelivered(servedTo('t1', 'USER'), DELIVERED, NOW),
            refusedWith(ForbiddenException, 'TENANT_ADMIN_REQUIRED'),
        );
        assert.deepEqual(ends.downloads, []);
    });

    test('a session that names no user is refused, and nothing is recorded', async () => {
        const { delivery, ends } = await delivering();
        const request = servedTo();
        delete request.user.sub;

        await assert.rejects(
            delivery.recordDelivered(request, DELIVERED, NOW),
            refusedWith(NotFoundException, 'TENANT_CONTEXT_MISSING'),
        );
        assert.deepEqual(ends.downloads, []);
    });
});

// @requirement SC-PRIV-020 — A tenant's administrator takes its full export, from the platform or the application
describe('the state a user reads says who delivers the export', () => {
    /** Both reads of the tenant's state, over `access`. */
    const readsOf = (access) => ({
        'GET billing/access': (request) =>
            new TenantAccessStateController(null, null, access).state(request),
        'GET billing/account/access': (request) =>
            new TenantInvoicesController({}, null, null, null, access).accessState(request),
    });
    const offerOf = (view) => [view.mayExport, view.exportDeliveredBy];

    test('to the administrator, the application, where it delivers the export', async () => {
        const { access } = await delivering();
        for (const [read, view] of Object.entries(readsOf(access))) {
            assert.deepEqual(offerOf(await view(servedTo())), [true, 'application'], read);
        }
    });

    test('to the administrator, the platform, where it serves the export', async () => {
        const holds = new FakeTenantAccessHoldRepository();
        const ends = new FakeSubscriptionEndRepository();
        await holdFor(holds, 't1', 'ended');
        await endOf(ends, 't1');
        const access = new TenantAccessService(holds, new Reflector());
        new TenantDataExportService(ends, { export: async () => null }, access).onModuleInit();
        for (const [read, view] of Object.entries(readsOf(access))) {
            assert.deepEqual(offerOf(await view(servedTo())), [true, 'platform'], read);
        }
    });

    test('to anybody who is not offered the export, nobody', async () => {
        const { access } = await delivering();
        for (const [read, view] of Object.entries(readsOf(access))) {
            for (const role of ['USER', 'SUPER_ADMIN']) {
                assert.deepEqual(
                    offerOf(await view(servedTo('t1', role))),
                    [false, null],
                    `${read}: ${role}`,
                );
            }
        }
    });

    test('while no end is recorded, nobody', async () => {
        const { access } = await delivering({ endRecorded: false });
        for (const [read, view] of Object.entries(readsOf(access))) {
            assert.deepEqual(offerOf(await view(servedTo())), [false, null], read);
        }
    });
});

/** An execution context for `request` to a route of the application's that carries no mark. */
function contextOf(request) {
    class ApplicationExportRoute {
        download() {}
    }
    return {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => ApplicationExportRoute.prototype.download,
        getClass: () => ApplicationExportRoute,
    };
}

// @requirement SC-PRIV-020 — A tenant's administrator takes its full export, from the platform or the application
describe("the download recorded is the session's tenant's alone", () => {
    test('a request naming another tenant anywhere but its session is answered for its session', async () => {
        const { delivery, ends } = await delivering();

        await assert.rejects(
            delivery.recordDelivered(
                servedTo('t2', 'TENANT_ADMIN', {
                    params: { tenantId: 't1' },
                    query: { tenantId: 't1' },
                    body: { tenantId: 't1' },
                }),
                DELIVERED,
                NOW,
            ),
            refusedWith(ConflictException, 'TENANT_EXPORT_NOT_OFFERED'),
            "t2 holds no ended reason of its own, so t1's end offers it nothing",
        );
        assert.deepEqual(ends.downloads, []);
    });

    test("another tenant's end, recorded under a reason of its own, records its own download only", async () => {
        const { delivery, holds, ends } = await delivering();
        await holdFor(holds, 't2', 'ended');
        await endOf(ends, 't2');

        await delivery.recordDelivered(
            servedTo('t2', 'TENANT_ADMIN', { query: { tenantId: 't1' } }),
            DELIVERED,
            NOW,
        );

        assert.deepEqual(
            ends.downloads.map((d) => [d.tenantId, d.subscriptionId]),
            [['t2', 'sub-t2']],
        );
    });
});

/** The ends and their downloads as a row-level policy shows them, refusing a row it hides. */
function endsBehindThePolicy() {
    const store = new FakeSubscriptionEndRepository();
    return {
        record: (end) => store.record(end),
        listFor: async (ids) => (await store.listFor(ids)).filter((e) => visibleTo(e.tenantId)),
        listExportDownloadsFor: async (ids) =>
            (await store.listExportDownloadsFor(ids)).filter((d) => visibleTo(d.tenantId)),
        recordExportDownload: async (download) => {
            if (!visibleTo(download.tenantId)) {
                throw new Error(
                    'new row violates row-level security policy for table "tenant_export_downloads"',
                );
            }
            return store.recordExportDownload(download);
        },
    };
}

/** The holds as the same policy shows them. */
function holdsBehindThePolicy() {
    const store = new FakeTenantAccessHoldRepository();
    return {
        record: (hold) => store.record(hold),
        listOpen: async (tenantId) => (visibleTo(tenantId) ? store.listOpen(tenantId) : []),
    };
}

// @requirement SC-SEC-020 — What crosses the tenant policy is named; a tenant's reach only its subscriber and itself
describe('the record is read and written past the tenant policy, wherever the application reports it', () => {
    test('a delivery reported in any frame is recorded for the session’s tenant, and audited', async () => {
        const recorded = {};
        for (const [name, within] of Object.entries(FRAMES)) {
            const { delivery, audited } = await delivering({
                ends: endsBehindThePolicy(),
                holds: holdsBehindThePolicy(),
                bypass: BYPASS,
            });
            recorded[name] = await within('t1', () =>
                delivery
                    .recordDelivered(servedTo(), DELIVERED, NOW)
                    .then((download) => [download.tenantId, audited.length], codeOf),
            );
        }

        assert.deepEqual(recorded, {
            'before the tenant frame': ['t1', 1],
            "in the tenant's frame": ['t1', 1],
            "in an operator's bypass": ['t1', 1],
        });
    });
});

// @requirement SC-CANC-033 — An ended subscription's deletion day is shown to the tenant and to the operator
describe("the operator's page lists a delivered download as it lists one the platform served", () => {
    test('with its moment, who took it and its size, the oldest first', async () => {
        const FIRST = new Date('2026-12-02T08:00:00.000Z');
        const SECOND = new Date('2026-12-09T08:00:00.000Z');
        const { access, ends, delivery } = await delivering();
        // The platform's own route over the same store, as an installation
        // that changed how it delivers the export leaves its earlier downloads.
        const file = {
            content: new TextEncoder().encode('{}'),
            mediaType: 'application/json',
            fileName: 'export.json',
        };
        const served = new TenantDataExportService(ends, { export: async () => file }, access);
        await served.take(
            't1',
            { userId: 'u-1', email: 'admin@t1.example', source: 'web', context: 's-1' },
            FIRST,
        );
        await delivery.recordDelivered(servedTo(), DELIVERED, SECOND);
        const admin = new AdminResourcesService(
            {
                getTenantDetail: async (slug) =>
                    slug === 'acme'
                        ? {
                              id: 't1',
                              slug: 'acme',
                              name: 'Acme',
                              isActive: true,
                              subscription: null,
                              users: [],
                          }
                        : null,
            },
            { log: async () => {} },
            access,
        );

        const [reason] = (await admin.getTenantDetail('acme')).accessReasons;

        const by = { by: 'web:admin@t1.example:s-1', userId: 'u-1' };
        assert.deepEqual(reason.exportDownloads, [
            { at: FIRST.toISOString(), ...by, size: file.content.byteLength },
            { at: SECOND.toISOString(), ...by, size: DELIVERED.size },
        ]);
    });
});
