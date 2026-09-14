// Runs the contract against a harness shaped like the README's usage example:
// every port and seed writer the example wires is a stand-in, everything else
// is absent, and the gaps are the ones the example declares. Spawned by
// `readme-example-declares-its-gaps.test.js` with a name pattern that selects
// the declaration check, which is the only scenario a stand-in can answer.

import { readFileSync } from 'node:fs';

import { persistenceAdapterContract } from '../../dist/index.js';

import { exampleParts, usageExample } from '../support/readme-example.js';

/** Answers every property with another stand-in, and is never a promise. */
function standIn() {
    return new Proxy(function standInMember() {}, {
        get: (_target, key) => (key === 'then' ? undefined : standIn()),
    });
}

const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const parts = exampleParts(usageExample(readme));

persistenceAdapterContract({
    name: 'the README usage example',
    create: async () => ({
        adapter: {
            capabilities: {
                transactions: true,
                pessimisticLocking: true,
                rowLevelSecurity: false,
                advisoryLocks: false,
            },
            ...Object.fromEntries(parts.adapter.map((name) => [name, standIn()])),
        },
        seed: Object.fromEntries(parts.seed.map((name) => [name, standIn()])),
        reset: async () => {},
    }),
    gaps: parts.gaps,
});
