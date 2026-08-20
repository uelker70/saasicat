import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPlanCatalogFromString } from '@saasicat/nest/billing';

import { applyTokens, planInit } from '../dist/index.js';

// Does the generated catalogue load?
//
// Everything else about `init` was asserted against rendered TEXT: that the
// YAML contains `quotas: {}`, that a key appears, that no token is left
// unsubstituted. All true, and none of it answers the only question an
// integrator has — the platform reads this file with Ajv at boot, and a
// document can be perfectly good YAML and still be refused.
//
// Two findings lived in that gap at once, and one of them was pinned as correct
// by a test:
//
//   - `init --project-key=notesapp`, the form the help text showed first, wrote
//     `quotas: {}`. `PlanDef` requires `quotas` with `minProperties: 1`, so the
//     first boot failed on `/plans/0/quotas: must NOT have fewer than 1
//     properties` — after every file was written and `app.module.ts` patched.
//   - `--quota=active-seats:Seat` wrote `active-seats: 25`. The key pattern is
//     `^[a-z][A-Za-z0-9]*$` under `additionalProperties: false`, so Ajv refused
//     it as an additional property. That was this package's own fixture.
//
// This runs the generated file through `loadPlanCatalogFromString` — the
// function the platform itself calls. It cannot drift from the rule it checks,
// and it keeps catching the next field nobody thought about.

const TEMPLATES = fileURLToPath(new URL('../templates/init/', import.meta.url));

/** The `config/saas.yaml` a set of options produces, rendered. */
async function generatedCatalog(options) {
    const plan = planInit(options);
    const file = plan.files.find((f) => f.path === 'config/saas.yaml');
    assert.ok(file, 'the plan writes no catalogue at all');
    const template = await readFile(join(TEMPLATES, `${file.template}.tpl`), 'utf8');
    return applyTokens(template, { ...plan.tokens, ...file.tokens });
}

describe('the catalogue init writes is one the platform accepts', () => {
    test('with a single quota', async () => {
        const yaml = await generatedCatalog({ projectKey: 'notesapp', quotas: ['notes:Note'] });
        const catalog = loadPlanCatalogFromString(yaml, { source: 'generated' });
        assert.equal(catalog.projectKey, 'notesapp');
        assert.ok(catalog.plans.length >= 1, 'a catalogue with no plans is not a catalogue');
        for (const plan of catalog.plans) {
            assert.ok(Object.keys(plan.quotas).length >= 1, `${plan.id} has no quotas`);
        }
    });

    test('with several, including a camel-cased key', async () => {
        const yaml = await generatedCatalog({
            projectKey: 'team-hub',
            quotas: ['notes:Note', 'activeSeats:Seat'],
        });
        const catalog = loadPlanCatalogFromString(yaml, { source: 'generated' });
        for (const plan of catalog.plans) {
            assert.deepEqual(Object.keys(plan.quotas).sort(), ['activeSeats', 'notes']);
        }
    });

    test('and with --skip-hasher, which does not touch the catalogue', async () => {
        const yaml = await generatedCatalog({
            projectKey: 'notesapp',
            quotas: ['notes:Note'],
            skipHasher: true,
        });
        assert.ok(loadPlanCatalogFromString(yaml, { source: 'generated' }));
    });

    test('the check is not vacuous — a hand-broken catalogue is refused', async () => {
        // Without this, the three above would pass on a loader that accepted
        // anything, which is exactly the shape of a guard that guards nothing.
        const yaml = await generatedCatalog({ projectKey: 'notesapp', quotas: ['notes:Note'] });
        assert.throws(
            () =>
                loadPlanCatalogFromString(yaml.replace(/notes: \d+/g, 'active-seats: 25'), {
                    source: 'generated',
                }),
            /quotas/,
            'the loader accepted a key the schema forbids',
        );
    });
});

describe('either init refuses the input, or the platform accepts the output', () => {
    // The invariant, and the reason the four cases above are not enough: they
    // all pass valid options, so they stay green with every rule removed. What
    // has to hold is that no input reaches the middle ground — written to disk
    // and refused at boot — which is where both findings lived.

    const INPUTS = [
        { projectKey: 'notesapp' },
        { projectKey: 'notesapp', quotas: [] },
        { projectKey: 'notesapp', quotas: ['active-seats:Seat'] },
        { projectKey: 'notesapp', quotas: ['active_seats:Seat'] },
        { projectKey: 'notesapp', quotas: ['ActiveSeats:Seat'] },
        { projectKey: 'notesapp', quotas: ['notes:Note'] },
        { projectKey: 'notesapp', quotas: ['notes:Note', 'activeSeats:Seat'] },
        { projectKey: 'team-hub', quotas: ['apiCalls:ApiCall'], skipHasher: true },
    ];

    for (const input of INPUTS) {
        test(JSON.stringify(input), async () => {
            let yaml;
            try {
                yaml = await generatedCatalog(input);
            } catch {
                return; // Refused before writing: the other acceptable outcome.
            }
            loadPlanCatalogFromString(yaml, { source: 'generated' });
        });
    }
});
