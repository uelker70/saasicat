// @requirement SC-OPS-002 — A migration is safe on a partially adopted schema
// @requirement SC-OPS-003 — An operator can list what a migration will touch before running it

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    applyFragmentBlocks,
    extractFragmentBlocks,
    extractModelBlocks,
    extractModelNames,
} from '../dist/index.js';

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
        assert.match(
            result.schema,
            /Inserted by `saasicat schema apply` from 01-subscription.prisma/,
        );
    });
});

describe('enums travel with the models that use them', () => {
    // `BillingCycle` on a `Subscription` field is a Prisma validation error
    // in a schema that has the model and not the enum. The first install of
    // the 1.0 candidate from npm produced twenty of those in quickstart
    // step 3 — the example app had carried the enums by hand since before
    // `schema apply` existed, so nothing in this tree ever saw the gap.
    const FRAGMENT = `enum BillingCycle {
  MONTHLY
  YEARLY
}

model Subscription {
  id           String       @id
  billingCycle BillingCycle
}
`;

    test('a fragment yields its enums and its models', () => {
        const blocks = extractFragmentBlocks(FRAGMENT);
        assert.deepEqual([...blocks.enums.keys()], ['BillingCycle']);
        assert.deepEqual([...blocks.models.keys()], ['Subscription']);
    });

    test('apply appends the enum above the model, once', () => {
        const schema = 'model Tenant {\n  id String @id\n}\n';
        const first = applyFragmentBlocks(schema, extractFragmentBlocks(FRAGMENT));
        assert.deepEqual(first.addedEnums, ['BillingCycle']);
        assert.deepEqual(first.added, ['Subscription']);
        assert.ok(
            first.schema.indexOf('enum BillingCycle') < first.schema.indexOf('model Subscription'),
            'the type should stand above the field that uses it',
        );

        const second = applyFragmentBlocks(first.schema, extractFragmentBlocks(FRAGMENT));
        assert.deepEqual(second.addedEnums, []);
        assert.deepEqual(second.skippedEnums, ['BillingCycle']);
        assert.equal(second.schema, first.schema);
    });

    test('an enum the consumer already declares is left alone', () => {
        const schema = 'enum BillingCycle {\n  MONTHLY\n  YEARLY\n  WEEKLY\n}\n';
        const result = applyFragmentBlocks(schema, extractFragmentBlocks(FRAGMENT));
        assert.deepEqual(result.skippedEnums, ['BillingCycle']);
        assert.match(result.schema, /WEEKLY/, "the consumer's own variant survives");
    });

    test('a bare model map still works, with no enums', () => {
        const result = applyFragmentBlocks('', extractModelBlocks(FRAGMENT));
        assert.deepEqual(result.added, ['Subscription']);
        assert.deepEqual(result.addedEnums, []);
    });
});
