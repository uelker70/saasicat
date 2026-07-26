import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSchema, parseEnumValues, parseFields, parseSchema } from '../dist/index.js';

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
