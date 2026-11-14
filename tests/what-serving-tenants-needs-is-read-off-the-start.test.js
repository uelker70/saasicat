import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { OPTIONAL_CANONICAL_MODELS, TENANT_SERVING_MEMBERS } from '../packages/core/dist/index.js';
import { prismaPersistence } from '../packages/adapter-prisma/dist/index.js';
import { drizzlePersistence } from '../packages/adapter-drizzle/dist/index.js';
import {
    PLATFORM_RULES,
    SaaSiCatConfigurationError,
    SaaSiCatModule,
    storeSecretsInPlainText,
} from '../packages/nest/dist/platform/index.js';

// `saasicat schema check` names the models a start with `tenantBilling` on
// cannot do without, and reads them from `TENANT_SERVING_MEMBERS`. Whether that
// list is right is a question about the start, so it is answered by starting:
// each member of each shipped bundle taken away in turn, once with an option on
// and once with none, and the members whose absence only the first start
// refuses have to be exactly the ones the list names for that option, each
// refused by the rule it names. With `tenantBilling`, that is the whole list;
// with every other option an entry names, it is the entries that name it. A
// rule that comes to need another member, stops needing one, or answers to
// another option fails here instead of leaving the check to say "not an error"
// about it.

const ADAPTERS = [
    ['prismaPersistence', (options) => prismaPersistence({ client: TOKEN, ...options })],
    ['drizzlePersistence', (options) => drizzlePersistence({ db: TOKEN, ...options })],
];

const TOKEN = Symbol('client');

const CATALOG = {
    app: { name: 'Probe' },
    currency: 'EUR',
    vatRate: 19,
    tenantBilling: {
        cancellationNoticeDays: { monthly: 0, yearly: 0 },
        selfServiceBlockedPlans: { asTarget: [], asSource: [] },
        endOfSubscription: { readOnlyDays: 30, reminderDaysBefore: [3] },
    },
    plans: [],
    features: [],
};

/** What every start serving tenants has to name, and nothing more. */
const SERVING_TENANTS = {
    notices: { port: { deliver: async () => ({ recipients: [], channel: 'probe' }) } },
    subscriptionEnds: {
        export: {
            export: async () => ({
                content: new Uint8Array(),
                mediaType: 'application/json',
                fileName: 'export.json',
            }),
        },
    },
};

/** The options of a start with `option` on and wired as little as it can be, or with none. */
function startWith(bundle, option) {
    const options = {
        planCatalog: CATALOG,
        defaultPlanId: 'STARTER',
        controller: { guards: [] },
        discoverySnapshotPath: null,
        persistence: bundle,
        adapters: { secretSealer: storeSecretsInPlainText() },
    };
    if (option === 'tenantBilling') options.tenantBilling = SERVING_TENANTS;
    else if (option !== undefined) options[option] = true;
    return options;
}

/** The ids of the rules that refuse a start with `options`. */
function refusals(options) {
    try {
        SaaSiCatModule.forRoot(options);
        return [];
    } catch (error) {
        if (!(error instanceof SaaSiCatConfigurationError)) throw error;
        return error.violations.map((violation) => violation.id);
    }
}

/**
 * The rules that refuse a start with `option` on and `member` taken away,
 * beyond what refuses the same start on the whole bundle and what refuses a
 * start with no option on and the member taken away.
 */
function refusedOnlyWith(bundle, option, member) {
    const without = lacking(bundle, member);
    const anyway = [
        ...refusals(startWith(bundle, option)),
        ...refusals(startWith(without, undefined)),
    ];
    return refusals(startWith(without, option)).filter((id) => !anyway.includes(id));
}

/** A slice of the bundle, as against a member: a plain object that is no provider. */
const isSlice = (value) =>
    Object.getPrototypeOf(value) === Object.prototype && !('useFactory' in value);

/** Every member the bundle provides, as `slice.member`, or its own key where it is no slice. */
function membersOf(bundle) {
    return Object.entries(bundle).flatMap(([key, value]) => {
        if (key === 'capabilities' || value === undefined) return [];
        if (!isSlice(value)) return [key];
        return Object.keys(value)
            .filter((member) => value[member] !== undefined)
            .map((member) => `${key}.${member}`);
    });
}

/** `bundle` without `member`. */
function lacking(bundle, member) {
    const [slice, key] = member.split('.');
    if (key === undefined) return { ...bundle, [slice]: undefined };
    return { ...bundle, [slice]: { ...bundle[slice], [key]: undefined } };
}

/** `options` with `value` set at the dotted `path`, the objects on the way copied. */
function withOption(options, path, value) {
    const [head, ...rest] = path.split('.');
    if (rest.length === 0) return { ...options, [head]: value };
    return { ...options, [head]: withOption(options[head] ?? {}, rest.join('.'), value) };
}

const NAMED = new Set(Object.values(TENANT_SERVING_MEMBERS).flatMap(({ models }) => models));

/** Every option an entry names. */
const OPTIONS = [
    ...new Set(Object.values(TENANT_SERVING_MEMBERS).flatMap(({ neededWith }) => neededWith)),
];

/** The entries that name `option`, each with its rule, as the probe reports them. */
const namedFor = (option) =>
    Object.fromEntries(
        Object.entries(TENANT_SERVING_MEMBERS)
            .filter(([, { neededWith }]) => neededWith.includes(option))
            .map(([member, { refusedBy }]) => [member, [refusedBy]]),
    );

// @requirement SC-COMP-021 — The schema check names apart what an application serving tenants cannot run without
describe('what a start serving tenants needs of the shipped bundles', () => {
    test('each bundle, whole, starts with tenantBilling on and with no option on', () => {
        for (const [name, build] of ADAPTERS) {
            const bundle = build({});
            assert.deepEqual(refusals(startWith(bundle, 'tenantBilling')), [], name);
            assert.deepEqual(refusals(startWith(bundle, undefined)), [], name);
        }
    });

    test('is every member whose absence refuses a start with tenantBilling on, each by the rule core names', () => {
        for (const [name, build] of ADAPTERS) {
            const bundle = build({});
            const members = membersOf(bundle);
            assert.ok(members.length > 30, `${name}: the members were read, ${members.length}`);

            const found = Object.fromEntries(
                members
                    .map((member) => [member, refusedOnlyWith(bundle, 'tenantBilling', member)])
                    .filter(([, rules]) => rules.length > 0),
            );
            assert.deepEqual(found, namedFor('tenantBilling'), name);
        }
    });

    // `adminResources` among them: an application that only administers its
    // tenants keeps their holds as well, and the check has to say so.
    test('names for each other option exactly the members a start with only that option on is refused without', () => {
        assert.ok(OPTIONS.includes('adminResources'), 'adminResources is one of them');
        for (const [name, build] of ADAPTERS) {
            const bundle = build({});
            for (const option of OPTIONS.filter((each) => each !== 'tenantBilling')) {
                // An option that cannot start on its own without tenant billing
                // is held to the listed members only: everything else its start
                // asks for, it asks for beside tenant billing.
                const alone = refusals(startWith(bundle, option)).length === 0;
                const probed = alone ? membersOf(bundle) : Object.keys(TENANT_SERVING_MEMBERS);
                const found = Object.fromEntries(
                    probed
                        .map((member) => [member, refusedOnlyWith(bundle, option, member)])
                        .filter(([, rules]) => rules.length > 0),
                );
                assert.deepEqual(found, namedFor(option), `${name}: ${option}`);
            }
        }
    });

    test("names for each entry the options its rule answers to, read off the rule's condition", () => {
        for (const { refusedBy, neededWith } of Object.values(TENANT_SERVING_MEMBERS)) {
            const rule = PLATFORM_RULES.find((each) => each.id === refusedBy);
            assert.ok(rule, refusedBy);
            const read = new Set();
            const recording = new Proxy(
                {},
                {
                    get: (_, key) => {
                        if (typeof key === 'string') read.add(key);
                        return undefined;
                    },
                },
            );
            rule.when({ options: recording, adapters: {} });
            const answers = [...read].filter((key) =>
                rule.when({ options: { [key]: true }, adapters: {} }),
            );
            assert.deepEqual([...answers].sort(), [...neededWith].sort(), refusedBy);
        }
    });

    test('takes the option an entry names in place of its member', () => {
        for (const [name, build] of ADAPTERS) {
            const bundle = build({});
            for (const [member, { refusedBy, orOption }] of Object.entries(
                TENANT_SERVING_MEMBERS,
            )) {
                if (orOption === undefined) continue;
                const without = startWith(lacking(bundle, member), 'tenantBilling');
                assert.ok(refusals(without).includes(refusedBy), `${name}: ${member} is needed`);
                assert.ok(
                    !refusals(withOption(without, orOption, {})).includes(refusedBy),
                    `${name}: ${orOption} stands in for ${member}`,
                );
            }
        }
    });

    test('holds an optional model exactly where leaving it out refuses a start with tenantBilling on', () => {
        for (const [name, build] of ADAPTERS) {
            for (const model of Object.keys(OPTIONAL_CANONICAL_MODELS)) {
                const bundle = build({ notAdopted: [model] });
                const notServing = refusals(startWith(bundle, undefined));
                const refused = refusals(startWith(bundle, 'tenantBilling')).filter(
                    (id) => !notServing.includes(id),
                );
                assert.equal(refused.length > 0, NAMED.has(model), `${name}: ${model}`);
            }
        }
    });
});

// The check prints these names for an integrator to adopt, so each has to be a
// model the shipped fragments declare; and one an application can also leave
// out has to be left out of the member it is named under here, or the two lists
// would describe different bundles.

/** Each shipped fragment: the comment lines before its first model, and the models it declares. */
function fragmentHeads() {
    const dir = join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        'packages/spec/prisma-fragments',
    );
    return readdirSync(dir)
        .filter((file) => file.endsWith('.prisma'))
        .map((file) => readFileSync(join(dir, file), 'utf8').split('\n'))
        .map((lines) => ({
            head: lines.slice(
                0,
                lines.findIndex((line) => line.startsWith('model ')),
            ),
            models: lines
                .filter((line) => line.startsWith('model '))
                .map((line) => line.split(/\s+/)[1]),
        }));
}

describe('the models a start serving tenants needs', () => {
    test('are models the shipped fragments declare', () => {
        const declared = new Set(fragmentHeads().flatMap(({ models }) => models));
        assert.ok(declared.size > 10, 'the fragments were read');
        for (const model of NAMED) assert.ok(declared.has(model), `${model} is a canonical model`);
    });

    // A fragment that says it is required wherever tenants are served is
    // adopted as one, so each model it declares is one the check has to name;
    // one the list missed would be called "not an error" under a header that
    // says the opposite.
    test('are every model of a fragment that says it is required wherever tenants are served', () => {
        const required = fragmentHeads().filter(({ head }) =>
            head.some((line) => line.startsWith('// Required wherever tenants are served')),
        );
        assert.ok(required.length >= 4, 'the fragments that say so were found');
        for (const { models } of required) {
            for (const model of models) assert.ok(NAMED.has(model), model);
        }
    });

    test('that are optional are left out of the member they are named under', () => {
        for (const [member, { models }] of Object.entries(TENANT_SERVING_MEMBERS)) {
            for (const model of models.filter((each) =>
                Object.hasOwn(OPTIONAL_CANONICAL_MODELS, each),
            )) {
                assert.ok(OPTIONAL_CANONICAL_MODELS[model].includes(member), `${model}: ${member}`);
            }
        }
    });
});
