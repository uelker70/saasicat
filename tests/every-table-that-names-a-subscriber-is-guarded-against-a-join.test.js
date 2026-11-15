// A join moves every row that names the subscriber joined, and the database
// refuses a row for it afterwards (`SC-ADM-050`). Both rest on one list,
// `SUBSCRIBER_OWNED_TABLES`: the adapters move the tables it names, and
// `1.0-a-subscriber-is-joined.postgres.sql` puts its trigger on the tables its
// own list names. A model added to the fragments with a `subscriberId` and left
// out of either would stay with the subscriber joined, where nobody reads it,
// or take rows for it after the join. So both lists are read against the
// fragments: every model that names a subscriber, under its table name.
//
// The adapters' own tables of these names are typed against the list
// (`satisfies Record<SubscriberOwnedTable, …>`), so the compiler holds them.

// @requirement SC-ADM-050 — A join moves everything in one step, and a subscriber joined is given nothing afterwards

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SUBSCRIBER_OWNED_TABLES } from '../packages/core/dist/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FRAGMENTS = join(ROOT, 'packages/spec/prisma-fragments');
const JOIN_MIGRATION = join(ROOT, 'packages/spec/sql/1.0-a-subscriber-is-joined.postgres.sql');

/** The first word of a line, without its indentation. */
const firstWordOf = (line) => line.trim().split(/\s+/)[0] ?? '';

/** The text between the first two double quotes of `line`. */
function quotedIn(line) {
    const open = line.indexOf('"');
    const close = line.indexOf('"', open + 1);
    return open === -1 || close === -1 ? null : line.slice(open + 1, close);
}

/** Every model of the fragments that has a `subscriberId` field, with its table. */
function modelsNamingASubscriber() {
    const found = [];
    for (const file of readdirSync(FRAGMENTS).filter((name) => name.endsWith('.prisma'))) {
        let model = null;
        for (const line of readFileSync(join(FRAGMENTS, file), 'utf8').split('\n')) {
            if (line.startsWith('model ')) {
                model = {
                    model: firstWordOf(line.slice('model '.length)),
                    table: null,
                    named: false,
                };
                continue;
            }
            if (!model) continue;
            if (line.startsWith('}')) {
                if (model.named) found.push({ table: model.table, model: model.model, file });
                model = null;
                continue;
            }
            if (firstWordOf(line) === 'subscriberId') model.named = true;
            if (line.trim().startsWith('@@map(')) model.table = quotedIn(line);
        }
    }
    return found.sort((a, b) => (a.table < b.table ? -1 : 1));
}

/** The tables the join migration puts its trigger on, as its list names them. */
function tablesTheMigrationGuards() {
    const text = readFileSync(JOIN_MIGRATION, 'utf8');
    const anchor = 'FOREACH owned IN ARRAY ARRAY[';
    const start = text.indexOf(anchor);
    assert.notEqual(start, -1, `${anchor} is no longer in the join migration`);
    const end = text.indexOf(']', start + anchor.length);
    return text
        .slice(start + anchor.length, end)
        .split(',')
        .map((entry) => entry.trim())
        .map((entry) => entry.slice(1, -1))
        .sort();
}

test('the fragments are read: some models name a subscriber', () => {
    // A scanner that found nothing would make the tests below true of nothing.
    assert.ok(modelsNamingASubscriber().length >= 10, 'the fragments were not read');
});

test('every model that names a subscriber is in the list a join moves, under its table', () => {
    const listed = SUBSCRIBER_OWNED_TABLES.map(({ table, model }) => ({ table, model })).sort(
        (a, b) => (a.table < b.table ? -1 : 1),
    );
    assert.deepEqual(
        modelsNamingASubscriber().map(({ table, model }) => ({ table, model })),
        listed,
    );
});

test('the join migration guards every table in that list, and no other', () => {
    assert.deepEqual(
        tablesTheMigrationGuards(),
        SUBSCRIBER_OWNED_TABLES.map(({ table }) => table).sort(),
    );
});
