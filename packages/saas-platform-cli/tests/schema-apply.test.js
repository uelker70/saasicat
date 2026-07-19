import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    applyFragmentBlocks,
    extractModelBlocks,
    extractModelNames,
} from '../dist/index.js';

// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P5.

describe('extractModelNames', () => {
    test('findet Top-Level-Models', () => {
        const schema = `
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql" }

model Plan {
  id String @id
}

model User { id String @id }
`;
        assert.deepEqual(extractModelNames(schema), ['Plan', 'User']);
    });

    test('ignoriert auskommentierte Models', () => {
        const schema = `// model OldThing { id String @id }
model Real { id String @id }`;
        assert.deepEqual(extractModelNames(schema), ['Real']);
    });

    test('findet keine enum-Blöcke', () => {
        const schema = `enum Role { ADMIN USER }
model X { id String @id }`;
        assert.deepEqual(extractModelNames(schema), ['X']);
    });
});

describe('extractModelBlocks', () => {
    test('Block bleibt komplett mit allen Zeilen', () => {
        const fragment = `// Kommentar
model Plan {
  id   String @id @default(cuid())
  name String

  @@index([name])
}

model Bundle {
  id String @id
}`;
        const blocks = extractModelBlocks(fragment);
        assert.equal(blocks.size, 2);
        assert.match(blocks.get('Plan'), /model Plan \{/);
        assert.match(blocks.get('Plan'), /@@index\(\[name\]\)/);
        assert.match(blocks.get('Plan'), /\}\s*$/);
        assert.match(blocks.get('Bundle'), /model Bundle \{[\s\S]*\}\s*$/);
    });
});

describe('applyFragmentBlocks', () => {
    const FRAGMENT = new Map([
        ['Plan', 'model Plan {\n  id String @id\n}'],
        ['Bundle', 'model Bundle {\n  id String @id\n}'],
        ['AuditEntry', 'model AuditEntry {\n  id String @id\n}'],
    ]);

    test('fügt alle Models hinzu wenn Schema leer von Plattform-Models', () => {
        const schema = `model User { id String @id }\n`;
        const result = applyFragmentBlocks(schema, FRAGMENT);
        assert.deepEqual(result.added, ['Plan', 'Bundle', 'AuditEntry']);
        assert.deepEqual(result.skipped, []);
        assert.match(result.schema, /model User \{/);
        assert.match(result.schema, /model Plan \{/);
        assert.match(result.schema, /model Bundle \{/);
        assert.match(result.schema, /model AuditEntry \{/);
    });

    test('idempotent: existierende Models bleiben unangetastet', () => {
        const schema = `model User { id String @id }\nmodel Plan { id Int @id }\n`;
        const result = applyFragmentBlocks(schema, FRAGMENT);
        assert.deepEqual(result.added, ['Bundle', 'AuditEntry']);
        assert.deepEqual(result.skipped, ['Plan']);
        // Existierender Plan-Block hat `Int @id` — neuer Block würde `String @id` mitbringen.
        // Existierender bleibt:
        assert.match(result.schema, /model Plan \{ id Int @id \}/);
    });

    test('returns identisches Schema, wenn alle Models schon da', () => {
        const schema = `model Plan { id String @id }\nmodel Bundle { id String @id }\nmodel AuditEntry { id String @id }\n`;
        const result = applyFragmentBlocks(schema, FRAGMENT);
        assert.deepEqual(result.added, []);
        assert.equal(result.schema, schema);
    });

    test('Label kommt in den Header-Kommentar', () => {
        const schema = `model User { id String @id }\n`;
        const result = applyFragmentBlocks(schema, FRAGMENT, {
            fragmentLabel: '01-subscription.prisma',
        });
        assert.match(result.schema, /Eingefügt durch `saas-platform schema apply` aus 01-subscription.prisma/);
    });
});
