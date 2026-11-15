// An application that invoices its own customers may already have a model
// called `SubscriptionInvoice`, for its own table. Compared field by field
// against the platform's model of that name, it would come out as every
// platform column missing — twenty lines that ask the integrator to turn their
// own invoices into the platform's. The table decides instead: a model under a
// platform model's name that keeps another table is a model of the
// application's own, and the check says so in one finding.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { checkSchema, parseSchema } from '../dist/index.js';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../bin/saasicat.js', import.meta.url));

const require = createRequire(import.meta.url);
const INVOICE_FRAGMENT = await readFile(
    join(
        dirname(require.resolve('@saasicat/spec')),
        'prisma-fragments',
        '20-subscription-invoice.prisma',
    ),
    'utf8',
);

/** The application's own invoices, under the name the platform gives its own. */
const OWN_INVOICES = `
model SubscriptionInvoice {
    id     String @id
    amount Int

    @@map("invoices")
}
`;

/** Each fragment taken whole, as `schema check` holds the one it reads. */
const UNITS = {
    fragments: [[...parseSchema(INVOICE_FRAGMENT).models.keys()]],
    optional: new Set(),
};

const OWN_CLASH = {
    model: 'SubscriptionInvoice',
    platformTable: 'subscription_invoices',
    applicationTable: 'invoices',
};

// @requirement SC-SCOPE-013 — Subscriber and invoice models avoid the application's own names, and a clash is reported
describe('an application model under a platform model’s name', () => {
    test('is a name clash, with neither its fields nor its table reported as drift', () => {
        const report = checkSchema(INVOICE_FRAGMENT, OWN_INVOICES, undefined, UNITS);

        assert.deepEqual(report.nameClashes, [OWN_CLASH]);
        assert.deepEqual(
            report.missingFields.filter(({ model }) => model === 'SubscriptionInvoice'),
            [],
        );
        assert.deepEqual(report.fieldMismatches, []);
        assert.deepEqual(report.missingBlockAttributes, []);
        assert.deepEqual(
            report.missingCompanions,
            [],
            'the platform’s invoice fragment was not adopted, so nothing of it is missing beside it',
        );
        assert.equal(report.ok, false);
    });

    test('is a name clash where it maps no table, and keeps the table its name gives it', () => {
        const unmapped = OWN_INVOICES.replace('    @@map("invoices")\n', '');

        const report = checkSchema(INVOICE_FRAGMENT, unmapped);

        assert.deepEqual(report.nameClashes, [
            { ...OWN_CLASH, applicationTable: 'SubscriptionInvoice' },
        ]);
        assert.deepEqual(report.missingFields, []);
        assert.equal(report.ok, false);
    });

    test('is not counted as compared, and a relation to the platform’s model is not asked of it', () => {
        const spec = `
model SubscriptionInvoice {
    id    String @id
    lines SubscriptionInvoiceLine[]

    @@map("subscription_invoices")
}

model SubscriptionInvoiceLine {
    id        String              @id
    invoiceId String
    invoice   SubscriptionInvoice @relation(fields: [invoiceId], references: [id])

    @@map("subscription_invoice_lines")
}
`;
        const app = `${OWN_INVOICES}
model SubscriptionInvoiceLine {
    id        String @id
    invoiceId String

    @@map("subscription_invoice_lines")
}
`;

        const report = checkSchema(spec, app);

        assert.deepEqual(report.nameClashes, [OWN_CLASH]);
        assert.deepEqual(
            report.missingFields,
            [],
            'the relation points at the platform’s model, which the application does not have',
        );
        assert.equal(report.checkedModelCount, 1);
    });

    test('may cascade from its tenant, since what the platform keeps past the tenant is not in it', () => {
        const spec = `
model SubscriptionContract {
    id       String @id
    tenantId String

    @@map("subscription_contracts")
}
`;
        const app = `
model SubscriptionContract {
    id       String @id
    tenantId String
    tenant   Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

    @@map("contracts")
}
`;

        const report = checkSchema(spec, app);

        assert.deepEqual(
            report.nameClashes.map(({ model }) => model),
            ['SubscriptionContract'],
        );
        assert.deepEqual(report.tenantCascades, []);
    });

    test('the platform’s own model under its table, with a column missing, is drift and no clash', () => {
        const spec = `
model SubscriptionInvoice {
    id     String @id
    number String

    @@map("subscription_invoices")
}
`;
        const app = spec.replace('    number String\n', '');

        const report = checkSchema(spec, app);

        assert.deepEqual(report.nameClashes, []);
        assert.deepEqual(report.missingFields, [
            { model: 'SubscriptionInvoice', field: 'number', type: 'String' },
        ]);
        assert.equal(report.ok, false);
    });
});

// @requirement SC-SCOPE-013 — Subscriber and invoice models avoid the application's own names, and a clash is reported
describe('schema check', () => {
    let workspace;
    before(async () => {
        workspace = await mkdtemp(join(tmpdir(), 'saasicat-name-clash-'));
    });
    after(async () => {
        await rm(workspace, { recursive: true, force: true });
    });

    test('names the model, both tables, and what to do about it', async () => {
        const file = join(workspace, 'schema.prisma');
        await writeFile(file, OWN_INVOICES, 'utf8');

        const failure = await run(process.execPath, [
            CLI,
            'schema',
            'check',
            `--prisma-schema=${file}`,
            '--fragments=20',
        ]).then(
            () => assert.fail('the check passed'),
            (error) => error,
        );

        assert.equal(failure.code, 1);
        assert.match(failure.stdout, /✗ Your own model under a platform model's name \(1\):/);
        assert.match(
            failure.stdout,
            /SubscriptionInvoice +your table invoices, the platform's subscription_invoices/,
        );
        assert.match(failure.stdout, /rename yours/);
        assert.doesNotMatch(failure.stdout, /Missing fields|Missing constraints|taken halfway/);
    });
});
