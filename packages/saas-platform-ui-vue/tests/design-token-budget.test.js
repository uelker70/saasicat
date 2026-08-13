import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { auditSummary } from '../../../scripts/token-audit.mjs';

// Design-token budgets — ratchets, not targets.
//
// The package ships a token file AND 644 literal colours, 80 distinct pixel
// values and 23 font sizes. That combination is worse than having no tokens at
// all: a reader cannot tell which value was a decision and which was a guess,
// so every new page guesses again, and the drift compounds.
//
// Fixing it is Phase 1 work, one file per PR. What this test does is stop the
// numbers from growing WHILE that happens — otherwise the migration is a race
// against new arrivals. Each PR that migrates a file lowers its budget; when a
// budget reaches its floor it becomes a hard rule.
//
// Update deliberately, never reflexively:
//     node packages/saas-platform-ui-vue/tests/design-token-budget.test.js --update
//
// A rising number is a regression even if the build is green.

const BASELINE_PATH = fileURLToPath(new URL('./design-token-baseline.json', import.meta.url));

/**
 * Where each budget is allowed to end up, and why that is the floor.
 *
 * These are not aspirations in a document — the test prints them next to the
 * current value, so the remaining distance is visible on every run.
 */
const FLOORS = {
    'hexColors.total': { floor: 0, why: 'every colour resolves to a semantic role token' },
    'functionalColors.total': { floor: 0, why: 'rgba() literals become shadow/overlay tokens' },
    'namedColors.total': {
        floor: 0,
        why: '`color: white` is a literal that hid from both patterns above',
    },
    distinctPixelValues: { floor: 12, why: 'the 12-step spacing scale' },
    // Zero, not "nine steps": this metric counts LITERAL sizes, and once every
    // declaration reads `var(--sa-text-*)` there are none left to count. The
    // scale itself is enforced where it can be — `theme-layer-discipline`
    // asserts that no `font-size` in the package names a number.
    distinctFontSizes: { floor: 0, why: 'every size reads a step of the type scale' },
    distinctBreakpoints: { floor: 5, why: 'xs/sm/md/lg/xl, aligned with Quasar' },
    'selfReferencingVars.total': { floor: 0, why: 'var(--x, var(--x)) is never meaningful' },
    worstStyleShare: { floor: 0.25, why: 'layout only; colour and surface come from primitives' },
};

/** Reads `a.b` out of the summary object. */
function pick(summary, path) {
    return path.split('.').reduce((node, key) => node?.[key], summary);
}

const summary = auditSummary();

if (process.argv.includes('--update')) {
    const next = Object.fromEntries(Object.keys(FLOORS).map((k) => [k, pick(summary, k)]));
    writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 4)}\n`);
    console.log(`Baseline written: ${BASELINE_PATH}`);
    process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));

describe('design-token budgets', () => {
    test('the audit reaches the source tree', () => {
        // Counted independently of what was found. Deriving reach from the
        // findings cannot work: every budget below is allowed to fall to zero
        // as the migration progresses, so "found nothing" is indistinguishable
        // from "looked at nothing" — a renamed directory or a broken file
        // predicate would report zero of everything and read as a spectacular
        // success.
        //
        // The floors sit well under today's 115 files / 80 style blocks. They
        // are here to catch a sweep that collapsed, not to pin the tree size.
        assert.ok(
            summary.reach.files >= 80,
            `the audit only reached ${summary.reach.files} files — check the path and the file predicate in scripts/token-audit.mjs`,
        );
        assert.ok(
            summary.reach.styleBlocks >= 50,
            `the audit found only ${summary.reach.styleBlocks} style blocks — SFC style extraction is no longer matching`,
        );
        assert.ok(
            Object.keys(baseline).length === Object.keys(FLOORS).length,
            'baseline and FLOORS describe different metrics — one of them was edited alone',
        );
    });

    for (const [metric, { floor, why }] of Object.entries(FLOORS)) {
        test(`${metric} does not grow (floor ${floor} — ${why})`, () => {
            const current = pick(summary, metric);
            const allowed = baseline[metric];

            assert.ok(
                typeof current === 'number',
                `the audit reports no value for "${metric}" — the summary shape changed`,
            );

            assert.ok(
                current <= allowed,
                `${metric} rose from ${allowed} to ${current}.\n` +
                    `  Target: ${floor} (${why}).\n` +
                    `  Use the token scale instead of a literal. If the increase is genuinely\n` +
                    `  unavoidable, say why in the PR and re-record with --update.`,
            );
        });

        test(`${metric} baseline has not overshot its floor`, () => {
            // Guards the other direction: once a budget reaches its floor the
            // ratchet has done its job and the metric becomes a hard rule. This
            // fails if someone records a baseline BELOW the floor, which would
            // mean the floor is wrong rather than the value.
            const allowed = baseline[metric];
            assert.ok(
                allowed >= floor,
                `${metric} baseline (${allowed}) is below its declared floor (${floor}). ` +
                    `Lower the floor in FLOORS and explain why — the scale changed.`,
            );
        });
    }
});
