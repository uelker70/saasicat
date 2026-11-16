// The rows the platform keeps of a tenant beyond its deletion — its reasons,
// its end and the day it was told, the downloads of its export, the notices it
// was sent — name the role somebody acted in, never who it was, and a notice
// keeps how many it went to rather than to whom (`SC-PRIV-023`). The run
// writes the roles in the transaction that closes the deletion, so a deletion
// that does not close leaves the rows as they were.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { DAY, DELETES_ON, ENDED_AT, ended, recordOf, setUp } from './helpers/tenant-deletion.js';

const ADMIN = 'web:ada@example.com:t1';
const OPERATOR = 'web:ops@example.com:operator';
const AT = (day) => new Date(`${day}T10:00:00.000Z`);

/** Records a reason of `tenantId`, lifted at `lifted` by `liftedBy` where given. */
async function aReason(run, tenantId, kind, recordedBy, lifted) {
    const hold = await run.holds.record({
        tenantId,
        kind,
        reference: null,
        note: null,
        since: AT('2026-08-01'),
        recordedBy,
    });
    if (lifted) await run.holds.lift(hold.id, AT('2026-08-05'), lifted);
}

/** A notice of `tenantId`, delivered to `recipients` unless they are null. */
async function aNotice(run, tenantId, subject, recipients) {
    const key = {
        tenantId,
        subscriptionId: `subscription-${tenantId}`,
        kind: 'deletion-reminder',
        subject,
    };
    const claimed = await run.notices.claim(key, {}, AT('2026-11-01'), AT('2026-10-01'));
    if (recipients) {
        await run.notices.confirm(
            claimed.id,
            claimed.claimedAt,
            { recipients, channel: 'email' },
            AT('2026-11-01'),
        );
    } else {
        await run.notices.release(claimed.id, claimed.claimedAt);
    }
}

/** Tenant t1, due on `DELETES_ON`, and tenant t2, not due, each with rows that name persons. */
async function twoTenantsWithTheirRows() {
    const run = await setUp();
    await ended(run, 't1', DELETES_ON, ADMIN);
    await aReason(run, 't1', 'suspended', OPERATOR, OPERATOR);
    await aReason(run, 't1', 'overdue', 'job:platform:overdue-invoices', 'cli:ops@example.com');
    await run.ends.announce({
        tenantId: 't1',
        subscriptionId: 'subscription-t1',
        endsAt: ENDED_AT,
        readOnlyDays: 30,
        deletesOn: DELETES_ON,
        announcedAt: AT('2026-10-01'),
        announcedBy: ADMIN,
    });
    await run.ends.recordExportDownload({
        tenantId: 't1',
        subscriptionId: 'subscription-t1',
        downloadedAt: AT('2026-11-10'),
        downloadedBy: ADMIN,
        downloadedByUserId: 'user-ada',
        size: 2048,
    });
    await aNotice(run, 't1', 'delivered', ['ada@example.com', 'bob@example.com']);
    await aNotice(run, 't1', 'undelivered', null);

    await aReason(run, 't2', 'suspended', OPERATOR, null);
    await aNotice(run, 't2', 'delivered', ['eve@example.com']);
    return run;
}

/** Every row the platform keeps of `tenantId`, as the stores hold them. */
async function rowsOf(run, tenantId) {
    return {
        holds: await run.holds.listAllOf(tenantId),
        ends: await run.ends.listEndsOfTenant(tenantId),
        announcements: await run.ends.listAnnouncedOfTenant(tenantId),
        downloads: await run.ends.listExportDownloadsOfTenant(tenantId),
        notices: [...run.notices.rows.values()].filter((row) => row.tenantId === tenantId),
    };
}

/** Who each reason of `tenantId` was recorded and lifted by, by kind. */
async function actorsOfReasons(run, tenantId) {
    return Object.fromEntries(
        (await run.holds.listAllOf(tenantId)).map((hold) => [
            hold.kind,
            [hold.recordedBy, hold.liftedBy],
        ]),
    );
}

// @requirement SC-PRIV-023 — A tenant's deletion leaves a record with the subscriber that names no person
describe('the rows a deleted tenant leaves', () => {
    test('name the role somebody acted in, and a notice how many it went to, never who', async () => {
        const run = await twoTenantsWithTheirRows();
        const otherBefore = structuredClone(await rowsOf(run, 't2'));

        assert.deepEqual(await run.service.deleteDue(DAY), { deleted: 1, halted: 0, failed: 0 });

        const rows = await rowsOf(run, 't1');
        const kept = JSON.stringify(rows);
        assert.ok(!kept.includes('@'), kept);
        assert.ok(!kept.includes('user-ada'), kept);
        assert.deepEqual(await actorsOfReasons(run, 't1'), {
            overdue: ['run', 'operator'],
            suspended: ['operator', 'operator'],
            ended: ['run', 'run'],
            deleting: ['run', null],
        });
        assert.deepEqual(
            rows.ends.map((end) => end.recordedBy),
            ['tenant-admin'],
        );
        assert.deepEqual(
            rows.announcements.map((announced) => announced.announcedBy),
            ['tenant-admin'],
        );
        assert.deepEqual(
            rows.downloads.map(({ downloadedBy, downloadedByUserId, downloadedAt, size }) => ({
                downloadedBy,
                downloadedByUserId,
                downloadedAt,
                size,
            })),
            [
                {
                    downloadedBy: 'tenant-admin',
                    downloadedByUserId: 'tenant-admin',
                    downloadedAt: AT('2026-11-10'),
                    size: 2048,
                },
            ],
        );
        assert.deepEqual(
            rows.notices.map((notice) => [
                notice.subject,
                notice.recipientCount,
                notice.delivery?.recipients ?? null,
                notice.recipientsForgottenAt instanceof Date,
            ]),
            [
                ['delivered', 2, [], true],
                ['undelivered', null, null, true],
            ],
        );
        assert.deepEqual(await rowsOf(run, 't2'), otherBefore, "another tenant's rows stay");
    });

    test('keep who acted where the transaction that closes the deletion fails, and the next run closes it', async () => {
        const run = await twoTenantsWithTheirRows();
        const before = structuredClone(await rowsOf(run, 't1'));
        const forget = run.notices.forgetRecipients;
        run.notices.forgetRecipients = async (...args) => {
            run.notices.forgetRecipients = forget;
            await forget(...args);
            throw new Error('the connection dropped');
        };

        assert.deepEqual(await run.service.deleteDue(DAY), { deleted: 0, halted: 0, failed: 1 });
        const record = recordOf(run, 't1');
        assert.equal(record.closedAt, null);
        assert.equal(record.lastFailure.step, 'close');
        const after = await rowsOf(run, 't1');
        assert.deepEqual(after.notices, before.notices, 'no recipient is forgotten');
        assert.deepEqual(after.ends, before.ends);
        assert.deepEqual(after.announcements, before.announcements);
        assert.deepEqual(after.downloads, before.downloads);
        assert.deepEqual(
            await actorsOfReasons(run, 't1'),
            {
                overdue: ['job:platform:overdue-invoices', 'cli:ops@example.com'],
                suspended: [OPERATOR, OPERATOR],
                ended: ['job:platform:subscription-ends', null],
                deleting: ['job:platform:tenant-deletions', null],
            },
            'no reason names a role yet, and the end still holds the tenant to reading',
        );

        assert.deepEqual(await run.service.deleteDue(DAY), { deleted: 1, halted: 0, failed: 0 });
        assert.ok(!JSON.stringify(await rowsOf(run, 't1')).includes('@'));
    });
});
