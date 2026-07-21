import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    applyFragmentBlocks,
    extractModelBlocks,
    extractModelNames,
} from '../dist/index.js';

// Spec: handoff/superadmin/QUICKSTART_SIMPLIFICATIONS.md §P5.

describe('extractModelNames', () => {
    test('finds top-level models', () => {
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

    test('ignores commented-out models', () => {
        const schema = `// model OldThing { id String @id }
model Real { id String @id }`;
        assert.deepEqual(extractModelNames(schema), ['Real']);
    });

    test('does not find enum blocks', () => {
        const schema = `enum Role { ADMIN USER }
model X { id String @id }`;
        assert.deepEqual(extractModelNames(schema), ['X']);
    });
});

describe('extractModelBlocks', () => {
    test('block stays complete with all lines', () => {
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

    test('adds all models when schema is empty of platform models', () => {
        const schema = `model User { id String @id }\n`;
        const result = applyFragmentBlocks(schema, FRAGMENT);
        assert.deepEqual(result.added, ['Plan', 'Bundle', 'AuditEntry']);
        assert.deepEqual(result.skipped, []);
        assert.match(result.schema, /model User \{/);
        assert.match(result.schema, /model Plan \{/);
        assert.match(result.schema, /model Bundle \{/);
        assert.match(result.schema, /model AuditEntry \{/);
    });

    test('idempotent: existing models remain untouched', () => {
        const schema = `model User { id String @id }\nmodel Plan { id Int @id }\n`;
        const result = applyFragmentBlocks(schema, FRAGMENT);
        assert.deepEqual(result.added, ['Bundle', 'AuditEntry']);
        assert.deepEqual(result.skipped, ['Plan']);
        // Existing Plan block has `Int @id` — a new block would bring `String @id`.
        // The existing one stays:
        assert.match(result.schema, /model Plan \{ id Int @id \}/);
    });

    test('returns identical schema when all models already present', () => {
        const schema = `model Plan { id String @id }\nmodel Bundle { id String @id }\nmodel AuditEntry { id String @id }\n`;
        const result = applyFragmentBlocks(schema, FRAGMENT);
        assert.deepEqual(result.added, []);
        assert.equal(result.schema, schema);
    });

    test('label appears in the header comment', () => {
        const schema = `model User { id String @id }\n`;
        const result = applyFragmentBlocks(schema, FRAGMENT, {
            fragmentLabel: '01-subscription.prisma',
        });
        assert.match(result.schema, /Eingefügt durch `saas-platform schema apply` aus 01-subscription.prisma/);
    });
});
