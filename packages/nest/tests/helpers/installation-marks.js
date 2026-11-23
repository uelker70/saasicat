// Where the mark of the installation is kept, in memory, marked and changed
// as `installation mark` writes it.

import assert from 'node:assert/strict';

import { FakeInstallationMarkRepository } from '../../dist/testing/index.js';

const MARKED_AT = new Date('2026-01-15T09:00:00.000Z');

/** Where the mark is kept, marked as `INT` in a test operation or a live one; unmarked with `null`. */
export async function marked(testOperation) {
    const marks = new FakeInstallationMarkRepository();
    if (testOperation !== null) await markAs(marks, testOperation);
    return marks;
}

/**
 * Marks the unmarked installation `marks` keeps as `INT`, in a test operation
 * or a live one, at `markedAt`.
 */
export async function markAs(marks, testOperation, markedAt = MARKED_AT) {
    const written = await marks.markIfUnmarked({
        identifier: 'INT',
        testOperation,
        markedAt,
        markedBy: 'cli:ops@example.com:host',
    });
    assert.ok(written, 'the installation was marked already');
}

/** Changes the operation the mark says, as `installation mark --replace` writes it. */
export async function changeTo(marks, testOperation) {
    const current = await marks.find();
    const changed = await marks.replace(current, { ...current, testOperation });
    assert.ok(changed, 'the mark was not changed');
}
