// A value in `config/saas.yaml` may name an environment variable.
//
// `monthly: ${NOTICE_DAYS}` is what lets one file serve local development and
// production: the file says where a value comes from, the deployment says what
// it is. What these hold is the part that makes that safe — the reference is
// resolved BEFORE the schema looks, so a variable standing in for an integer is
// still held to `integer, minimum: 0`; a variable nobody set stops the boot
// with its name and its field; and a value that does not fit is refused rather
// than read as `NaN` or `0`, which would be the silent zero the move into the
// file exists to end, one level down.
//
// Every refusal is a `PlanCatalogValidationError`, the class a schema violation
// raises, so the message reads `field: what is wrong` whatever the cause — and
// the catalogue import, which already maps that class to 400, refuses an
// uploaded document that tries to read the server's environment.

import { describe, test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    loadPlanCatalogFromFile,
    loadPlanCatalogFromString,
    PlanCatalogImporterService,
    PlanCatalogValidationError,
} from '../dist/billing/index.js';

// Block style throughout: inside a YAML flow collection (`{ … }` / `[ … ]`) a
// bare `${X}` opens a nested mapping and the parser refuses it, so a reference
// there has to be quoted. That is YAML, not the platform, and the guide says so.
const FILE = `
schemaVersion: 1
app:
  name: \${APP_NAME}
  label: \${APP_NAME} Cockpit
  version: \${BUILD}
currency: \${CURRENCY:-EUR}
vatRate: \${VAT}
tenantBilling:
  cancellationNoticeDays:
    monthly: \${NOTICE_DAYS}
    yearly: \${YEARLY_NOTICE_DAYS:-90}
  selfServiceBlockedPlans:
    asTarget: ['\${BLOCKED_PLAN}']
    asSource: []
features:
  - { key: CORE }
plans:
  - id: BASIC
    tagline: Price $5 and \${ and \${9} and \${X:-
    popular: \${POPULAR}
    quotas:
      users: \${MAX_USERS}
    features: [CORE]
`;

const ENV = {
    APP_NAME: 'Demo',
    BUILD: '1234',
    VAT: '19.5',
    NOTICE_DAYS: '14',
    BLOCKED_PLAN: 'ENTERPRISE',
    POPULAR: 'true',
    MAX_USERS: '5',
};

const load = (yaml, env) => loadPlanCatalogFromString(yaml, { source: 'test', env });

/** The refusal `fn` raises, checked to be the loader's own class. */
function refusal(fn) {
    try {
        fn();
    } catch (error) {
        assert.ok(error instanceof PlanCatalogValidationError, `${error.name}: ${error.message}`);
        return error;
    }
    assert.fail('expected the document to be refused');
}

// @requirement SC-CFG-020 — A value in the configuration file may name an environment variable
describe('a reference is resolved before the schema looks, as the type the field declares', () => {
    test('an integer field reads the variable as an integer', () => {
        const catalog = load(FILE, ENV);
        assert.strictEqual(catalog.tenantBilling.cancellationNoticeDays.monthly, 14);
        assert.strictEqual(catalog.plans[0].quotas.users, 5);
    });

    test('a number, a boolean and a string field each read it as their own type', () => {
        const catalog = load(FILE, ENV);
        assert.strictEqual(catalog.vatRate, 19.5);
        assert.strictEqual(catalog.plans[0].popular, true);
        // Digits stay a string where the field is one — a build number is what
        // goes into `version`, and reading it as YAML would make it a number.
        assert.strictEqual(catalog.app.version, '1234');
    });

    test('a reference may sit inside a string and inside a list', () => {
        const catalog = load(FILE, ENV);
        assert.equal(catalog.app.label, 'Demo Cockpit');
        assert.deepEqual(catalog.tenantBilling.selfServiceBlockedPlans.asTarget, ['ENTERPRISE']);
    });

    test('a dollar sign that opens no well-formed reference is ordinary text', () => {
        const catalog = load(FILE, ENV);
        assert.equal(catalog.plans[0].tagline, 'Price $5 and ${ and ${9} and ${X:-');
    });

    test('the schema still decides after the value is resolved', () => {
        // `eur` resolves fine and is not a currency code; the refusal is the
        // schema's, on the resolved value — not a pass because a variable stood
        // there, and not a refusal of the reference itself.
        const error = refusal(() => load(FILE, { ...ENV, CURRENCY: 'eur' }));
        assert.match(error.message, /currency: must match pattern/);
    });

    test('a document without a reference is untouched', () => {
        const plain = `
schemaVersion: 1
app: { name: Plain }
currency: EUR
vatRate: 19
tenantBilling:
  cancellationNoticeDays: { monthly: 7, yearly: 7 }
  selfServiceBlockedPlans: { asTarget: [], asSource: [] }
plans:
  - { id: BASIC, quotas: { users: 1 }, features: [] }
`;
        // No environment at all — and nothing to resolve, so nothing to refuse.
        const catalog = load(plain, undefined);
        assert.equal(catalog.app.name, 'Plain');
        assert.strictEqual(catalog.tenantBilling.cancellationNoticeDays.monthly, 7);
    });
});

// @requirement SC-CFG-021 — A variable the file names and nothing sets stops the installation, naming both
describe('a variable nobody set', () => {
    test('is refused with the variable and the field', () => {
        const error = refusal(() => load(FILE, { ...ENV, NOTICE_DAYS: undefined }));
        assert.match(error.message, /tenantBilling\.cancellationNoticeDays\.monthly: /);
        assert.match(error.message, /\$\{NOTICE_DAYS\}/);
        assert.match(error.message, /not set/);
        // The way out is in the sentence: the default syntax, with the name filled in.
        assert.match(error.message, /\$\{NOTICE_DAYS:-<value>\}/);
    });

    test('every missing variable is named at once, not one per restart', () => {
        const error = refusal(() => load(FILE, { ...ENV, NOTICE_DAYS: undefined, VAT: undefined }));
        assert.match(error.message, /\$\{NOTICE_DAYS\}/);
        assert.match(error.message, /\$\{VAT\}/);
        assert.deepEqual(
            error.errors.map((e) => e.params.envVar),
            ['VAT', 'NOTICE_DAYS'],
        );
    });

    test('a default declared in the file stands in for it', () => {
        const catalog = load(FILE, ENV);
        assert.strictEqual(catalog.tenantBilling.cancellationNoticeDays.yearly, 90);
        assert.equal(catalog.currency, 'EUR');
    });

    test('a set variable wins over the default', () => {
        const catalog = load(FILE, { ...ENV, YEARLY_NOTICE_DAYS: '30' });
        assert.strictEqual(catalog.tenantBilling.cancellationNoticeDays.yearly, 30);
    });

    test('a variable set to nothing takes the default too', () => {
        // Shell semantics for `:-`: empty counts as unset. A deployment that
        // exports the name with no value has not made a decision.
        const catalog = load(FILE, { ...ENV, YEARLY_NOTICE_DAYS: '' });
        assert.strictEqual(catalog.tenantBilling.cancellationNoticeDays.yearly, 90);
    });

    test('without a default, an empty variable is a value, and the schema judges it', () => {
        const error = refusal(() => load(FILE, { ...ENV, APP_NAME: '' }));
        assert.match(error.message, /app\.name: must NOT have fewer than 1 characters/);
    });
});

// @requirement SC-CFG-022 — A variable whose value does not fit the field is refused, not read as zero
describe('a value that does not fit the field', () => {
    for (const [text, why] of [
        ['abc', 'letters'],
        ['1.5', 'a fraction'],
        ['1e3', 'scientific notation'],
        [' 14', 'a leading space'],
        ['', 'nothing'],
    ]) {
        test(`${why} is refused for an integer field, and neither NaN nor zero gets through`, () => {
            const error = refusal(() => load(FILE, { ...ENV, NOTICE_DAYS: text }));
            assert.match(error.message, /tenantBilling\.cancellationNoticeDays\.monthly: /);
            assert.match(error.message, /\$\{NOTICE_DAYS\}/);
            assert.match(error.message, /takes integer/);
            assert.ok(error.message.includes(JSON.stringify(text)), error.message);
        });
    }

    test('a whole negative number is an integer — the schema then applies its minimum', () => {
        const error = refusal(() => load(FILE, { ...ENV, NOTICE_DAYS: '-1' }));
        assert.match(error.message, /tenantBilling\.cancellationNoticeDays\.monthly: must be >= 0/);
    });

    test('a number field refuses a comma decimal', () => {
        const error = refusal(() => load(FILE, { ...ENV, VAT: '19,5' }));
        assert.match(
            error.message,
            /vatRate: \$\{VAT\} resolves to "19,5", and the field takes number/,
        );
    });

    test('a boolean field accepts only true and false', () => {
        const error = refusal(() => load(FILE, { ...ENV, POPULAR: 'yes' }));
        assert.match(error.message, /plans\.0\.popular: .*takes boolean/);
    });

    test('a variable cannot stand in for a whole list', () => {
        const yaml = FILE.replace("asTarget: ['${BLOCKED_PLAN}']", 'asTarget: ${BLOCKED_PLAN}');
        const error = refusal(() => load(yaml, ENV));
        assert.match(error.message, /selfServiceBlockedPlans\.asTarget: .*takes a array/);
        assert.match(error.message, /a variable per entry/);
    });
});

// @requirement SC-CFG-023 — A variable whose name says it holds a credential may not be referenced from the file
describe('a credential named in the file', () => {
    for (const name of [
        'STRIPE_SECRET',
        'stripe_client_secret',
        'API_TOKEN',
        'DB_PASSWORD',
        'SMTP_PASSWD',
        'AWS_CREDENTIALS',
        'JWT_PRIVATE_KEY',
        'SENDGRID_API_KEY',
        'S3_ACCESS_KEY',
        'WEBHOOK_SIGNING_KEY',
    ]) {
        test(`\${${name}} is refused whether or not it is set`, () => {
            const yaml = FILE.replace('name: ${APP_NAME}', `name: \${${name}}`);
            const error = refusal(() => load(yaml, { ...ENV, [name]: 'sk_live_x' }));
            assert.match(error.message, /app\.name: .*names a credential/);
            // The value itself must not be in the message: the message is logged.
            assert.doesNotMatch(error.message, /sk_live_x/);
        });
    }

    for (const name of ['APP_NAME', 'BRAND_NAME', 'ENTERPRISE_PLAN_KEY', 'APP_KEY', 'TOKENIZER']) {
        test(`\${${name}} is an ordinary variable`, () => {
            const yaml = FILE.replace('name: ${APP_NAME}', `name: \${${name}}`);
            assert.equal(load(yaml, { ...ENV, [name]: 'Fine' }).app.name, 'Fine');
        });
    }
});

// @requirement SC-CFG-024 — The environment is resolved only for the installation's own configuration file
describe('a document that did not come from the file', () => {
    test('has every reference refused when no environment is given', () => {
        const error = refusal(() => load(FILE, undefined));
        assert.match(error.message, /app\.name: refers to \$\{APP_NAME\}/);
        assert.match(
            error.message,
            /resolved only when the platform reads its own configuration file/,
        );
        // All of them, not the first: the list is what tells a reader the
        // document as a whole is one that expects an environment.
        assert.deepEqual(
            new Set(error.errors.map((e) => e.params.envVar)),
            new Set([...Object.keys(ENV), 'CURRENCY', 'YEARLY_NOTICE_DAYS']),
        );
    });

    test('the catalogue import gives none, so an upload cannot read the server environment', async () => {
        const sink = {
            upsertPlan: async () => ({ created: true }),
            upsertPlanVersion: async () => ({ created: true }),
            upsertFeatureCatalogEntry: async () => ({ created: true }),
        };
        const service = new PlanCatalogImporterService(sink);
        const probe = `PROBE_${process.pid}`;
        process.env[probe] = 'leaked';
        try {
            await assert.rejects(
                () => service.importFromYaml(FILE.replace('${APP_NAME}\n', `\${${probe}}\n`)),
                (error) => {
                    assert.ok(error instanceof PlanCatalogValidationError);
                    assert.doesNotMatch(error.message, /leaked/);
                    return true;
                },
            );
        } finally {
            delete process.env[probe];
        }
    });
});

describe('the file the platform reads at boot', () => {
    let dir;
    afterEach(() => {
        if (dir) rmSync(dir, { recursive: true, force: true });
        dir = undefined;
    });

    // @requirement SC-CFG-020 — A value in the configuration file may name an environment variable
    test('resolves against the process environment unless told otherwise', () => {
        dir = mkdtempSync(join(tmpdir(), 'saasicat-env-'));
        const path = join(dir, 'saas.yaml');
        writeFileSync(path, FILE);
        const probe = `SAASICAT_PROBE_${process.pid}`;
        const withProbe = FILE.replace('${APP_NAME}\n', `\${${probe}}\n`);
        writeFileSync(path, withProbe);
        process.env[probe] = 'From the process';
        for (const [name, value] of Object.entries(ENV)) process.env[name] = value;
        try {
            assert.equal(loadPlanCatalogFromFile({ path }).app.name, 'From the process');
            // An explicit environment replaces the process one entirely.
            assert.equal(
                loadPlanCatalogFromFile({ path, env: { ...ENV, [probe]: 'Handed in' } }).app.name,
                'Handed in',
            );
        } finally {
            delete process.env[probe];
            for (const name of Object.keys(ENV)) delete process.env[name];
        }
    });
});
