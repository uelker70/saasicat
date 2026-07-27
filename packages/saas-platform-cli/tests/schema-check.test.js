import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    blankStringLiterals,
    checkSchema,
    parseEnumValues,
    parseFields,
    parseSchema,
} from '../dist/index.js';

const SPEC = `
enum BillingCycle {
    MONTHLY
    YEARLY
}

model Subscription {
    id           String       @id @default(uuid())
    tenantId     String       @unique
    plan         String
    billingCycle BillingCycle @default(YEARLY)
    trialEndsAt  DateTime?
    tags         String[]

    // Relations — consumer must define \`Tenant\` and enable the relation.
    // tenant Tenant @relation(fields: [tenantId], references: [id])

    @@index([tenantId])
    @@map("subscriptions")
}
`;

describe('parseFields', () => {
    test('reads name, type and modifiers, skips attributes and comments', () => {
        const fields = parseFields(`model X {
    id       String    @id
    note     String?
    tags     String[]
    // comment String
    @@map("xs")
}`);
        assert.deepEqual([...fields.keys()], ['id', 'note', 'tags']);
        assert.deepEqual(fields.get('note'), {
            name: 'note',
            type: 'String',
            optional: true,
            list: false,
        });
        assert.deepEqual(fields.get('tags'), {
            name: 'tags',
            type: 'String',
            optional: false,
            list: true,
        });
    });

    test('reads single-line model blocks', () => {
        const fields = parseFields('model X { id String @id }');
        assert.deepEqual([...fields.keys()], ['id']);
    });
});

describe('parseEnumValues', () => {
    test('reads members and ignores attributes', () => {
        assert.deepEqual(parseEnumValues('enum E {\n  A\n  B @map("b")\n}'), ['A', 'B']);
    });

    test('reads members sharing one line', () => {
        assert.deepEqual(parseEnumValues('enum Role { ADMIN USER }'), ['ADMIN', 'USER']);
    });
});

describe('parseSchema', () => {
    test('separates models from enums', () => {
        const parsed = parseSchema(SPEC);
        assert.deepEqual([...parsed.models.keys()], ['Subscription']);
        assert.deepEqual([...parsed.enums.keys()], ['BillingCycle']);
    });

    test('commented-out relations are not fields', () => {
        const parsed = parseSchema(SPEC);
        assert.equal(parsed.models.get('Subscription').has('tenant'), false);
    });
});

describe('checkSchema', () => {
    test('identical schema has no drift', () => {
        const report = checkSchema(SPEC, SPEC);
        assert.equal(report.ok, true);
        assert.equal(report.checkedModelCount, 1);
        assert.equal(report.checkedEnumCount, 1);
    });

    test('consumer extensions are not drift', () => {
        const app = SPEC.replace(
            'trialEndsAt  DateTime?',
            'trialEndsAt  DateTime?\n    customVehicles Int?\n    tenant Tenant @relation(fields: [tenantId], references: [id])',
        );
        const report = checkSchema(SPEC, app);
        assert.equal(report.ok, true);
        assert.deepEqual(report.missingFields, []);
    });

    test('missing field in an adopted model fails', () => {
        const app = SPEC.replace('    trialEndsAt  DateTime?\n', '');
        const report = checkSchema(SPEC, app);
        assert.equal(report.ok, false);
        assert.deepEqual(report.missingFields, [
            { model: 'Subscription', field: 'trialEndsAt', type: 'DateTime?' },
        ]);
    });

    test('absent model is informational, not a failure', () => {
        const report = checkSchema(SPEC, 'enum BillingCycle {\n  MONTHLY\n  YEARLY\n}');
        assert.equal(report.ok, true);
        assert.deepEqual(report.absentModels, ['Subscription']);
        assert.equal(report.checkedModelCount, 0);
    });

    test('missing enum value in an adopted enum fails', () => {
        const app = SPEC.replace('    YEARLY\n', '');
        const report = checkSchema(SPEC, app);
        assert.equal(report.ok, false);
        assert.deepEqual(report.missingEnumValues, [{ enum: 'BillingCycle', value: 'YEARLY' }]);
    });

    test('absent enum is informational, not a failure', () => {
        const app = SPEC.replace(/enum BillingCycle \{[\s\S]*?\}/, '');
        const report = checkSchema(SPEC, app);
        assert.deepEqual(report.absentEnums, ['BillingCycle']);
        assert.equal(report.missingEnumValues.length, 0);
    });

    test('type change is a mismatch', () => {
        const app = SPEC.replace('plan         String', 'plan         Int');
        const report = checkSchema(SPEC, app);
        assert.equal(report.ok, false);
        assert.deepEqual(report.fieldMismatches, [
            {
                model: 'Subscription',
                field: 'plan',
                reason: 'type',
                expected: 'String',
                actual: 'Int',
            },
        ]);
    });

    test('String replaced by a locally declared enum is allowed', () => {
        const app = SPEC.replace('plan         String', 'plan         PlanKey').replace(
            'enum BillingCycle {',
            'enum PlanKey {\n    BASIC\n    PRO\n}\n\nenum BillingCycle {',
        );
        const report = checkSchema(SPEC, app);
        assert.equal(report.ok, true);
    });

    test('String[] replaced by a local enum list is allowed', () => {
        const app = SPEC.replace('tags         String[]', 'tags         TagKey[]').replace(
            'enum BillingCycle {',
            'enum TagKey {\n    A\n    B\n}\n\nenum BillingCycle {',
        );
        const report = checkSchema(SPEC, app);
        assert.equal(report.ok, true);
    });

    test('a non-String spec type is not substitutable by an enum', () => {
        const app = SPEC.replace('trialEndsAt  DateTime?', 'trialEndsAt  Phase?').replace(
            'enum BillingCycle {',
            'enum Phase {\n    EARLY\n}\n\nenum BillingCycle {',
        );
        const report = checkSchema(SPEC, app);
        assert.equal(report.ok, false);
        assert.equal(report.fieldMismatches[0].reason, 'type');
    });

    test('a consumer widening a required field to nullable is a mismatch', () => {
        const app = SPEC.replace('plan         String', 'plan         String?');
        const report = checkSchema(SPEC, app);
        assert.equal(report.ok, false);
        assert.deepEqual(report.fieldMismatches, [
            {
                model: 'Subscription',
                field: 'plan',
                reason: 'optionality',
                expected: 'String',
                actual: 'String?',
            },
        ]);
    });

    test('a consumer tightening a nullable field to required is allowed', () => {
        const app = SPEC.replace('trialEndsAt  DateTime?', 'trialEndsAt  DateTime');
        const report = checkSchema(SPEC, app);
        assert.equal(report.ok, true);
        assert.deepEqual(report.fieldMismatches, []);
    });

    test('list change is a mismatch', () => {
        const app = SPEC.replace('tags         String[]', 'tags         String');
        const report = checkSchema(SPEC, app);
        assert.equal(report.ok, false);
        assert.equal(report.fieldMismatches[0].reason, 'list');
    });
});

describe('block attributes', () => {
    const WITH_ATTRS = `
model Subscription {
    id       String @id
    tenantId String
    plan     String

    @@unique([tenantId, plan])
    @@index([tenantId])
    @@index([plan, tenantId])
    @@map("subscriptions")
}
`;

    test('identical attributes produce no finding', () => {
        const report = checkSchema(WITH_ATTRS, WITH_ATTRS);
        assert.deepEqual(report.missingBlockAttributes, []);
        assert.equal(report.ok, true);
    });

    test('a missing index is reported but does not fail the check', () => {
        const app = WITH_ATTRS.replace('    @@index([plan, tenantId])\n', '');
        const report = checkSchema(WITH_ATTRS, app);
        assert.deepEqual(report.missingBlockAttributes, [
            { model: 'Subscription', kind: 'index', expected: '@@index([plan,tenantId])' },
        ]);
        assert.equal(report.ok, true);
    });

    test('a missing unique constraint fails the check', () => {
        const app = WITH_ATTRS.replace('    @@unique([tenantId, plan])\n', '');
        const report = checkSchema(WITH_ATTRS, app);
        assert.equal(report.missingBlockAttributes[0].kind, 'unique');
        assert.equal(report.ok, false);
    });

    test('a diverging @@map fails the check and names both sides', () => {
        const app = WITH_ATTRS.replace('@@map("subscriptions")', '@@map("abos")');
        const report = checkSchema(WITH_ATTRS, app);
        assert.deepEqual(report.missingBlockAttributes, [
            {
                model: 'Subscription',
                kind: 'map',
                expected: '@@map("subscriptions")',
                actual: 'abos',
            },
        ]);
        assert.equal(report.ok, false);
    });

    test('whitespace and attribute options do not create false findings', () => {
        const app = WITH_ATTRS.replace(
            '@@index([plan, tenantId])',
            '@@index([plan,tenantId], map: "custom_idx")',
        );
        const report = checkSchema(WITH_ATTRS, app);
        assert.deepEqual(report.missingBlockAttributes, []);
    });

    test('extra consumer indexes are not reported', () => {
        const app = WITH_ATTRS.replace('    @@map', '    @@index([id])\n    @@map');
        const report = checkSchema(WITH_ATTRS, app);
        assert.deepEqual(report.missingBlockAttributes, []);
        assert.equal(report.ok, true);
    });
});

describe('parser hardening (review findings)', () => {
    test('a commented-out @@unique or @@map counts as absent, not present', () => {
        const spec = 'model S {\n  id String @id\n  tenantId String\n\n  @@unique([tenantId])\n  @@map("subscriptions")\n}';
        const app = 'model S {\n  id String @id\n  tenantId String\n\n  // @@unique([tenantId])\n  // @@map("subscriptions")\n}';
        const report = checkSchema(spec, app);
        assert.equal(report.ok, false);
        assert.deepEqual(
            report.missingBlockAttributes.map((a) => a.kind).sort(),
            ['map', 'unique'],
        );
    });

    test('a brace inside a string default does not close the model early', () => {
        const schema =
            'model A {\n  id String @id\n  template String @default("}")\n  later String\n}\n\nmodel B {\n  id String @id\n}';
        const parsed = parseSchema(schema);
        assert.deepEqual([...parsed.models.keys()], ['A', 'B']);
        assert.deepEqual([...parsed.models.get('A').keys()], ['id', 'template', 'later']);
    });

    test('a // inside a string literal is not treated as a comment', () => {
        const parsed = parseSchema('model A {\n  id String @id\n  url String @default("http://x")\n  after String\n}');
        assert.deepEqual([...parsed.models.get('A').keys()], ['id', 'url', 'after']);
    });

    test('indexed field arguments are parsed past their parentheses', () => {
        const schema =
            'model A {\n  title String\n\n  @@index([title(sort: Desc)])\n  @@index([title(length: 10)])\n  @@map("a")\n}';
        const attrs = parseSchema(schema).modelAttributes.get('A');
        assert.equal(attrs.indexes.size, 2);
        assert.equal(attrs.map, 'a');
    });

    test('@@map survives the comment strip', () => {
        const attrs = parseSchema('model A {\n  id String @id\n\n  @@map("subscriptions")\n}').modelAttributes.get('A');
        assert.equal(attrs.map, 'subscriptions');
    });
});

describe('blankStringLiterals', () => {
    test('blanks contents, keeps quotes and length', () => {
        const line = '  x String @default("}")';
        const out = blankStringLiterals(line);
        assert.equal(out.length, line.length);
        assert.equal(out, '  x String @default(" ")');
        assert.equal(out.includes('}'), false);
    });

    test('handles escaped quotes without leaving the string early', () => {
        const out = blankStringLiterals('a "x\\"}" }');
        // Only the brace OUTSIDE the string survives.
        assert.equal((out.match(/\}/g) ?? []).length, 1);
    });

    test('leaves a line without strings untouched', () => {
        assert.equal(blankStringLiterals('model A { id String @id }'), 'model A { id String @id }');
    });

    test('is linear on pathological input', () => {
        const evil = '"' + '\\"'.repeat(20000);
        const started = process.hrtime.bigint();
        blankStringLiterals(evil);
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        assert.ok(ms < 500, `took ${ms}ms — expected linear behaviour`);
    });
});
