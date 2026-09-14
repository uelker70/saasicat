// The usage example in the README is what an integrator copies. Copied as it
// stands, it has to pass the contract's own declaration check: every part it
// leaves out named in `gaps`, and nothing named there that it wires.

// @requirement SC-COMP-012 — Where one implementation cannot do what another can, the gap is recorded

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { exampleParts, usageExample } from './support/readme-example.js';
import { runTestFile } from './support/tap.js';

const README = new URL('../README.md', import.meta.url);
const FIXTURE = fileURLToPath(new URL('./fixtures/readme-example.js', import.meta.url));
const DECLARATION_CHECK = 'the declared gaps are exactly the parts the harness does not provide';

describe('the README usage example', () => {
    const parts = exampleParts(usageExample(readFileSync(README, 'utf8')));

    test('is read: it wires ports and seed writers and declares gaps', () => {
        assert.ok(parts.adapter.includes('subscriptionRepository'), parts.adapter.join(', '));
        assert.ok(parts.seed.includes('createPlanVersion'), parts.seed.join(', '));
        assert.ok(parts.gaps.length > 0, 'the example declares no gap to show');
    });

    test('declares exactly the parts its harness leaves out', () => {
        const run = runTestFile(FIXTURE, { args: [`--test-name-pattern=${DECLARATION_CHECK}`] });
        assert.equal(run.fail, 0, run.output);
        assert.equal(run.pass, 1, run.output);
    });
});
