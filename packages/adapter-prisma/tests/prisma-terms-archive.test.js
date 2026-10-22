// What the Prisma adapter asks the client for the archive of the operator's
// terms. That a version is kept once when two starts archive it at the same
// time, and that the triggers refuse every change of it, is the persistence
// contract's to prove against PostgreSQL in tests/integration/. What this
// holds is the translation: one conflict-free write, the checksum read only
// where it wrote nothing, and the answers read back as the port says.

// @requirement SC-CFG-038 — The terms are a version and a file, and an archived version stays as it was

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS_ERROR_CODES, TERMS_ARCHIVE_TRIGGERS, isPersistenceRefusal } from '@saasicat/core';

import { PrismaTermsArchive } from '../dist/index.js';

const CHECKSUM = 'a'.repeat(64);

const TERMS = {
    version: '2026-10',
    checksum: CHECKSUM,
    mediaType: 'application/pdf',
    fileName: 'agb-2026-10.pdf',
    content: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
    archivedAt: new Date('2026-10-22T08:00:00.000Z'),
};

/**
 * A client that records what it is asked: `written` is what the insert gives
 * back, `stored` what a read by version finds, `triggers` what `$queryRaw` does.
 */
function recordingClient({ written = [], stored = null, triggers = [] } = {}) {
    const asked = [];
    const answer = (name, value) => async (args) => {
        asked.push([name, args]);
        return value;
    };
    return {
        asked,
        termsVersion: {
            createManyAndReturn: answer('createManyAndReturn', written),
            findUnique: answer('findUnique', stored),
        },
        $queryRaw: answer('$queryRaw', triggers),
    };
}

describe('the Prisma archive of the terms', () => {
    test('stores a version conflict-free, and asks for nothing more where it was written', async () => {
        const client = recordingClient({ written: [{ version: '2026-10' }] });

        await new PrismaTermsArchive(client).store(TERMS);

        assert.deepEqual(client.asked, [
            [
                'createManyAndReturn',
                { data: [TERMS], skipDuplicates: true, select: { version: true } },
            ],
        ]);
    });

    test('a version stored before is the same write for its checksum, and refused for another', async () => {
        const same = recordingClient({ stored: { checksum: CHECKSUM } });
        await new PrismaTermsArchive(same).store(TERMS);
        assert.deepEqual(same.asked[1], [
            'findUnique',
            { where: { version: '2026-10' }, select: { checksum: true } },
        ]);

        await assert.rejects(
            new PrismaTermsArchive(recordingClient({ stored: { checksum: 'b'.repeat(64) } })).store(
                TERMS,
            ),
            (error) =>
                isPersistenceRefusal(error) &&
                error.code === SETTINGS_ERROR_CODES.TERMS_VERSION_CHANGED,
        );
    });

    test('reads a version back as bytes of its own, and nothing where none is kept', async () => {
        const kept = await new PrismaTermsArchive(recordingClient({ stored: TERMS })).read(
            '2026-10',
        );

        assert.deepEqual(kept, TERMS);
        assert.notEqual(kept.content, TERMS.content);
        assert.equal(await new PrismaTermsArchive(recordingClient()).read('2026-11'), null);
    });

    test('says what would let a version change, from the enabled triggers of its table', async () => {
        const guarded = recordingClient({
            triggers: TERMS_ARCHIVE_TRIGGERS.map((name) => ({ name })),
        });

        assert.equal(await new PrismaTermsArchive(guarded).protectionProblem(), null);
        const problem = await new PrismaTermsArchive(recordingClient()).protectionProblem();
        assert.ok(problem.includes(`lacks ${TERMS_ARCHIVE_TRIGGERS.join(' and ')},`), problem);
        const [, query] = guarded.asked[0];
        assert.ok(query.join('?').includes("tgenabled IN ('O', 'A')"), query.join('?'));
        assert.ok(query.join('?').includes("to_regclass('terms_versions')"), query.join('?'));
    });
});
