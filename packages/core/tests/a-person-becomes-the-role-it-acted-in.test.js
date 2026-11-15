// Who acted, once the tenant is gone.
//
// The rows the platform keeps of a tenant beyond its deletion — its holds, its
// end, the day it was told, the downloads of its export — name whoever acted
// as the audit log tags an actor: `job:platform:<job>`, `cli:<email>:<host>`,
// `web:<email>:<context>`. The deletion replaces each with the role it acted in.
// A run and the command line say their role in the tag. A `web:` tag does not:
// the operator and the tenant's administrator sign in alike, so the role is the
// one the column is written in — a suspension and a lift are the operator's,
// the end, the announcement and the download the tenant's administrator's, and
// any other hold the run's. An operator acting as the tenant on its routes is
// written as the tenant's administrator, whose role it acted in. A tag that is
// none of the three is read as `web:` would be, and is never kept.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { actorRoleOf } from '../dist/index.js';

const COLUMNS = [
    'hold.recordedBy.suspended',
    'hold.recordedBy.other',
    'hold.liftedBy',
    'end.recordedBy',
    'announcement.announcedBy',
    'download.downloadedBy',
];

// @requirement SC-PRIV-023 — A tenant's deletion leaves a record with the subscriber that names no person
describe('a person in a row that outlives its tenant becomes the role it acted in', () => {
    test('a run is the run, whichever column it wrote', () => {
        for (const column of COLUMNS) {
            assert.equal(actorRoleOf('job:platform:subscription-ends', column), 'run', column);
        }
    });

    test('the command line is the operator, whichever column it wrote', () => {
        for (const column of COLUMNS) {
            assert.equal(actorRoleOf('cli:op@x:host', column), 'operator', column);
        }
    });

    test('a suspension recorded from the web is the operator', () => {
        assert.equal(actorRoleOf('web:a@b:app', 'hold.recordedBy.suspended'), 'operator');
    });

    test('any other hold recorded from the web is the run', () => {
        assert.equal(actorRoleOf('web:a@b:app', 'hold.recordedBy.other'), 'run');
    });

    test('a hold lifted from the web is the operator', () => {
        assert.equal(actorRoleOf('web:a@b:app', 'hold.liftedBy'), 'operator');
    });

    test('an end recorded from the web is the tenant administrator', () => {
        assert.equal(actorRoleOf('web:a@b:app', 'end.recordedBy'), 'tenant-admin');
    });

    test('an announcement from the web is the tenant administrator', () => {
        assert.equal(actorRoleOf('web:a@b:app', 'announcement.announcedBy'), 'tenant-admin');
    });

    test('a download from the web is the tenant administrator', () => {
        assert.equal(actorRoleOf('web:a@b:app', 'download.downloadedBy'), 'tenant-admin');
    });

    test('a tag of no known kind is read as the web, never kept', () => {
        for (const tag of ['x', '', 'JOB:platform:x', 'unknown@example.com']) {
            for (const column of COLUMNS) {
                assert.equal(
                    actorRoleOf(tag, column),
                    actorRoleOf('web:a@b:app', column),
                    `${JSON.stringify(tag)} in ${column}`,
                );
            }
        }
    });
});
