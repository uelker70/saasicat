import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { OPTIONAL_CANONICAL_MODELS } from '../packages/core/dist/index.js';
import { prismaPersistence } from '../packages/adapter-prisma/dist/index.js';
import { drizzlePersistence } from '../packages/adapter-drizzle/dist/index.js';

// A schema that leaves a model out gets a bundle without the members that need
// it, so the platform decides at start what it can do without them — instead of
// a request failing on a table that is not there. The members are read from
// OPTIONAL_CANONICAL_MODELS, the one list both adapters answer to, and both
// adapters are held to it here.

const ADAPTERS = [
    ['prismaPersistence', (options) => prismaPersistence({ client: TOKEN, ...options })],
    ['drizzlePersistence', (options) => drizzlePersistence({ db: TOKEN, ...options })],
];

const TOKEN = Symbol('client');
const at = (bundle, path) => path.split('.').reduce((node, key) => node?.[key], bundle);
const MODELS = Object.keys(OPTIONAL_CANONICAL_MODELS);

// @requirement SC-COMP-016 — What the schema check calls not adopted, the persistence bundle can be told
for (const [name, build] of ADAPTERS) {
    describe(`${name}({ notAdopted })`, () => {
        test('without it, every optional member is built', () => {
            const bundle = build({});
            for (const members of Object.values(OPTIONAL_CANONICAL_MODELS)) {
                for (const member of members) {
                    if (member === 'core.superAdminProvisioning') continue; // needs a hasher
                    assert.ok(at(bundle, member), `${member} is built`);
                }
            }
        });

        for (const model of MODELS) {
            test(`${model} left out leaves out ${OPTIONAL_CANONICAL_MODELS[model].join(', ')} and nothing else`, () => {
                const whole = build({});
                const without = build({ notAdopted: [model] });
                for (const member of OPTIONAL_CANONICAL_MODELS[model]) {
                    assert.equal(at(without, member), undefined, member);
                }
                const kept = MODELS.filter((other) => other !== model)
                    .flatMap((other) => OPTIONAL_CANONICAL_MODELS[other])
                    .filter((member) => !OPTIONAL_CANONICAL_MODELS[model].includes(member));
                for (const member of kept) {
                    assert.equal(Boolean(at(without, member)), Boolean(at(whole, member)), member);
                }
            });
        }

        test('a model the bundle cannot do without is refused, naming the ones it can', () => {
            assert.throws(
                () => build({ notAdopted: ['Subscription'] }),
                /Subscription.*PromoCodeHold/s,
            );
        });

        test('a password hasher for a schema without SuperAdmin users is refused', () => {
            assert.throws(
                () =>
                    build({
                        passwordHasher: { hash: async () => '', verify: async () => false },
                        notAdopted: ['SuperAdminUser'],
                    }),
                /passwordHasher.*notAdopted/s,
            );
        });
    });
}

// The names are the ones the schema check prints, so they have to be models the
// shipped fragments declare — a name that is not one could never be copied out
// of the check's output, and the option it belongs to would never be used.
describe('the models a bundle can be told are not adopted', () => {
    test('are models the shipped fragments declare', () => {
        const fragments = join(
            dirname(fileURLToPath(import.meta.url)),
            '..',
            'packages/spec/prisma-fragments',
        );
        const declared = new Set(
            readdirSync(fragments)
                .filter((file) => file.endsWith('.prisma'))
                .flatMap((file) => readFileSync(join(fragments, file), 'utf8').split('\n'))
                .filter((line) => line.startsWith('model '))
                .map((line) => line.split(/\s+/)[1]),
        );

        assert.ok(declared.size > 10, 'the fragments were read');
        for (const model of Object.keys(OPTIONAL_CANONICAL_MODELS)) {
            assert.ok(declared.has(model), `${model} is a canonical model`);
        }
    });
});
