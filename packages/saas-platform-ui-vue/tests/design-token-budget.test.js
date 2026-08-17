import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { audit, auditSummary, summarise } from '../../../scripts/token-audit.mjs';

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
    // These sit in TypeScript and reach the DOM through a `:style` binding, so
    // no codemod may touch them and each one was a judgement about which role it
    // means. All 56 are now roles: the five duplicated accent ramps became one
    // in the theme, and `DIFF_STYLE` reads roles.
    'scriptColors.total': { floor: 0, why: 'an inline style can read a role token too' },
    // The third place a colour can be written, and the one no category read
    // until the metric above it was found to be false: `hexColors` printed
    // `0 in 0 files` while twelve literals sat in six templates. Zero from the
    // start rather than a ratchet, because they were all fixable in the same
    // pass and an attribute reads `var(--sa-color-…)` exactly as a rule does.
    'templateColors.total': {
        floor: 0,
        why: 'a style attribute can read a role token as well as a rule can',
    },
    // The half of that debt a literal count cannot see. `accent + '15'` contains
    // no colour, so `scriptColors` read 0 while two backgrounds rendered fully
    // transparent — the trick needs a six-digit hex and the accents had just
    // become `var()`. Zero from the start: unlike a literal, there is never a
    // reason to keep one.
    'alphaConcats.total': {
        floor: 0,
        why: 'color-mix(in srgb, X n%, transparent) works for a var() too',
    },
    // `distinctPixelValues` used to sit here and is gone on purpose, not to make
    // a number go away. It asked one question of three different things:
    // `padding: 6px` (a scale should answer it), `max-width: 1100px` (a
    // one-off decision) and `@media (max-width: 980px)` (a breakpoint). The
    // three metrics that replace it are each stricter than it was, and between
    // them they cover every pixel it covered:
    //
    //   scalePixels      floor 0     — every one must read a token
    //   dimensionPixels  ratchet     — a measurement is not a rung
    //   offScaleBreakpoints floor 0  — every reflow point is one of Quasar's
    // Zero, not "at most twelve distinct" — a strictly stronger rule, on the
    // properties where a scale means something. Every one of these must read a
    // token, so what is left is by construction the list of values that are not
    // on the scale. Baselined at today's count because the migration itself is
    // a layout change and belongs in its own pass.
    'scalePixels.total': { floor: 0, why: 'padding, margin, gap, inset and radius read the scale' },
    // A ratchet with no target at all, and that is the point. A drawer being
    // 280px wide is a decision taken once; collapsing 59 such measurements onto
    // twelve values would be ceremony, not clarity — the same reason 0/1/2px
    // are exempt above. What it must not do is grow.
    //
    // It DID grow once, from 285 to 298, and not because anything was written:
    // the audit read a `<style>` block and only half of an inline `style="…"`,
    // so thirteen `min-width`/`max-width` measurements in dialog cards had
    // never been counted. A number rising because the sweep got wider is the
    // opposite of a ratchet being raised to let a change through, and the
    // difference is not a matter of trust — the inline-style fixture below is
    // what makes it checkable.
    'dimensionPixels.total': {
        floor: 0,
        why: 'a one-off measurement is a decision, not a rung — this one only ratchets',
    },
    // Zero, not "nine steps": this metric counts LITERAL sizes, and once every
    // declaration reads `var(--sa-text-*)` there are none left to count. The
    // scale itself is enforced where it can be — `theme-layer-discipline`
    // asserts that no `font-size` in the package names a number.
    distinctFontSizes: { floor: 0, why: 'every size reads a step of the type scale' },
    // The three scales AP2 declares next to the type sizes, and the three that
    // had a token family and no metric. Totals rather than distinct counts: a
    // scale is finished when nobody writes a VALUE, and a DISTINCT count barely
    // moves while that happens: `font-weight` reads the same handful of values
    // with every site outstanding and with one site left.
    //
    // Ratchets at the measured status quo, not blockers. Reaching zero on the
    // first of them needs a decision this script cannot take: `800` is the one
    // weight the package writes that the scale has no rung for — it stops at
    // `--sa-weight-bold` (700) — so somebody has to either add the rung or rule
    // those sites out. Recording the number is what puts that decision in front
    // of a person; `pnpm tokens` prints the weights by frequency.
    'fontWeights.total': {
        floor: 0,
        why: 'every weight reads --sa-weight-* — needs a rung for 800, or 13 fewer of them',
    },
    'lineHeights.total': { floor: 0, why: 'nine --sa-leading-* steps, one per type step' },
    'letterSpacings.total': { floor: 0, why: 'four --sa-tracking-* steps cover the tracking' },
    // The blind spot one property over from the one this file was fixed for.
    // `font: 700 40px/1 var(--sa-font-head)` sets a weight, a size and a line
    // height in one declaration, and all three metrics above are anchored on
    // the LONGHAND name — so all three read past it. The package's last literal
    // font SIZE hides in one of these, which is why `distinctFontSizes` reads 0
    // and is not the whole answer. The count is the baseline entry below; it is
    // not repeated here, where it would only fall out of step.
    'fontShorthands.total': {
        floor: 0,
        why: 'a `font:` shorthand names a size, a weight and a leading — all three have tokens',
    },
    // The colour decisions no colour pattern can see, because they are class
    // names: `class="text-grey-7"` holds no hex, no function and no CSS keyword,
    // and it resolves to Quasar's palette one layer BELOW the roles — so it
    // keeps its grey when the dark theme moves the surface under it.
    //
    // Counted here rather than banned by an ESLint rule carrying the thirteen
    // files that may keep theirs: an exception list is the same defect one
    // level up. The rule is worth writing when this number is 0 and can stay
    // there.
    'quasarColorClasses.total': {
        floor: 0,
        why: 'a palette class is a role token written one layer too low',
    },
    // The same decision written as Quasar's prop instead of Quasar's class, and
    // the metric above was blind to it while claiming to be the one nothing
    // could see: `<q-icon color="grey-7">` RENDERS `class="text-grey-7"`, so
    // the class form was debt and the thing that produces it was free.
    //
    // Its own budget rather than folded into the one above, because the two
    // migrate differently — a class comes off with a CSS rule, a prop with a
    // component's API — and folding them would have moved a recorded number in
    // a commit that wrote no template.
    //
    // A ratchet, and the reason is that the two halves of it are not the same
    // debt. A hue (`grey-7`, `amber-9`) is a colour the theme cannot move, and
    // the role layer has a name for what that text is. A brand or status name
    // (`primary`, `negative`) resolves through `--q-*`, which the theme does
    // read — and Quasar's `color` prop takes a palette name and nothing else,
    // so driving those to zero means not using the prop at all. That is a
    // decision about the component layer, not one this script may take;
    // recording the number is what puts it in front of a person.
    'quasarColorProps.total': {
        floor: 0,
        why: 'a hue sits below the roles; whether a brand name may stay is a decision to take',
    },
    // Informational, floor 0. The old floor of 5 asked "how many", and the
    // package legitimately needs only three of Quasar's bands — with 5 as a
    // floor, arriving at the goal made the baseline undershoot it and the
    // second assertion below fire. The rule that matters is the next one.
    distinctBreakpoints: { floor: 0, why: "fewer of Quasar's bands than five is not debt" },
    // The actual rule: a value Quasar does not share. A component that reflows
    // at 980px inside an app whose grid moves at 1024px leaves a 44px band
    // where the two disagree, and the package had six such values.
    'offScaleBreakpoints.total': {
        floor: 0,
        why: "every reflow point is one of Quasar's own bands",
    },
    'selfReferencingVars.total': { floor: 0, why: 'var(--x, var(--x)) is never meaningful' },
    worstStyleShare: { floor: 0.25, why: 'layout only; colour and surface come from primitives' },
};

/** Reads `a.b` out of the summary object. */
function pick(summary, path) {
    return path.split('.').reduce((node, key) => node?.[key], summary);
}

/**
 * The audit's own numbers, over a tree written for the question being asked.
 *
 * Every budget in this file is allowed to reach zero, which is what makes the
 * package unusable as evidence that a pass still works: "found nothing" and
 * "looked at nothing" are the same report, and six of the recorded budgets
 * already read 0. Any assertion phrased as "the package still contains at least
 * N of these" therefore has an expiry date, and it expires by FAILING on the
 * cleanup it was written to protect.
 *
 * A fixture has no such date. It holds exactly the shape under test, no later
 * PR can tidy it away, and it can answer both directions of a question rather
 * than only the one the current tree happens to contain.
 *
 * @param {Record<string, string>} files file name → contents
 */
function auditOf(files) {
    const dir = mkdtempSync(join(tmpdir(), 'saasicat-token-audit-'));
    try {
        for (const [name, content] of Object.entries(files)) {
            writeFileSync(join(dir, name), content);
        }
        return summarise(audit(dir));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
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
        // EQUAL, not a floor. A `.vue` file the SFC parser stops reading yields
        // no props and therefore no findings, which is indistinguishable from a
        // clean template — and a floor of "most of them" would let that happen
        // one file at a time. Every SFC in the package must parse.
        assert.equal(
            summary.reach.templates,
            summary.reach.vueFiles,
            `${summary.reach.vueFiles - summary.reach.templates} of ${summary.reach.vueFiles} SFCs did not parse — ` +
                'their templates were skipped, and a skipped template reports as a clean one',
        );
        assert.ok(
            Object.keys(baseline).length === Object.keys(FLOORS).length,
            'baseline and FLOORS describe different metrics — one of them was edited alone',
        );
    });

    test('the inline-style sweep reads a fixture it cannot miss', () => {
        // The reach counter the test above cannot supply from the package
        // itself. An inline `style="…"` was pulled out of the AST and then
        // read for colours only, so thirteen dimensions and four font sizes sat
        // outside every number this file guards; when the sweep widened,
        // `dimensionPixels` moved 285 → 298 in a commit that wrote no CSS. What
        // has to stay checkable is that the sweep is still alive.
        //
        // This used to be `reach.inlineStyles >= 15`, and that number was a
        // floor under the package's own debt — so the day enough `style`
        // attributes moved onto classes, every token metric would improve and
        // this assertion would fail. A guard that forbids the cleanup it exists
        // to measure is worse than no guard: it teaches the next contributor to
        // lower the threshold, which is the one move a ratchet may never invite.
        //
        // The fixture proves more than the count did, too. `margin-top: 6px` is
        // reachable only through the inline path — the SFC has no `<style>`
        // block — so this fails if the filter stops matching `style`, if the
        // counter stops being incremented, or if the fragments stop being fed
        // to the declaration pass. That last one is the regression that
        // actually happened.
        const found = auditOf({
            'InlineStyle.vue': '<template>\n    <p style="margin-top: 6px">x</p>\n</template>\n',
        });
        assert.equal(
            found.reach.inlineStyles,
            1,
            'the sweep did not count a static `style` attribute — an attribute it stops ' +
                'reading reports as an attribute with no literals',
        );
        assert.equal(
            found.scalePixels.total,
            1,
            'the sweep counted the attribute but did not read it as CSS — the fragments are ' +
                'no longer reaching the declaration pass, which is how thirteen dimensions ' +
                'hid the first time',
        );
    });

    test('a CSS-wide keyword is not a typographic value', () => {
        // `font-weight: inherit` names no weight: it takes the one the parent
        // already decided. The four typography metrics read a declaration's
        // whole value, so each recorded the keyword as a literal — and the
        // budget's advice, "read a token instead", is not something a
        // declaration that exists in order to inherit can act on.
        //
        // Absent from the package today, which is why this needs a fixture: the
        // tree cannot show that the filter works, and the day somebody writes
        // one, a green suite would have said nothing about it in advance.
        const inherits = auditOf({
            'inherits.css': [
                '.a { font-weight: inherit; }',
                '.b { line-height: unset; }',
                '.c { letter-spacing: revert; }',
                '.d { font-size: initial; }',
                '.e { font-weight: revert-layer; }',
                // The flag belongs to the declaration, not to the value — and
                // this is the form the package writes to out-specify Quasar.
                '.f { line-height: INHERIT !important; }',
            ].join('\n'),
        });
        assert.equal(
            inherits.reach.styleBlocks,
            1,
            'the fixture was not read at all — "found nothing" and "looked at nothing" are ' +
                'the same report, and every assertion below would pass on an empty sweep',
        );
        assert.deepEqual(
            {
                fontWeights: inherits.fontWeights.total,
                lineHeights: inherits.lineHeights.total,
                letterSpacings: inherits.letterSpacings.total,
                distinctFontSizes: inherits.distinctFontSizes,
            },
            { fontWeights: 0, lineHeights: 0, letterSpacings: 0, distinctFontSizes: 0 },
            'a CSS-wide keyword inherits or resets to a value that already exists — counting ' +
                'it puts a component that deliberately inherits into the typography budget',
        );

        // The other direction, and the one a wider filter would break: a real
        // value is still the literal these metrics exist to count.
        const values = auditOf({
            'values.css': [
                '.a { font-weight: 700; }',
                '.b { line-height: 1.4; }',
                '.c { letter-spacing: 0.02em; }',
                '.d { font-size: 13px; }',
            ].join('\n'),
        });
        assert.deepEqual(
            {
                fontWeights: values.fontWeights.total,
                lineHeights: values.lineHeights.total,
                letterSpacings: values.letterSpacings.total,
                distinctFontSizes: values.distinctFontSizes,
            },
            { fontWeights: 1, lineHeights: 1, letterSpacings: 1, distinctFontSizes: 1 },
            'a literal typographic value is what these metrics are for — a filter that ' +
                'quiets one of them has stopped measuring',
        );
    });

    test('a palette prop counts on a Quasar component and nowhere else', () => {
        // `quasarColorProps` counts `color`, `text-color` and `bg-color`, and
        // for a while it read them off every element the parser handed it —
        // because the attribute walk discarded the tag. `color` is a palette
        // entry on one of Quasar's components and an ordinary prop name
        // anywhere else, so a chart component declaring its own `color` raised
        // a metric it has nothing to do with and could fail the ratchet without
        // introducing a single palette dependency.
        //
        // Both directions, because either alone passes for the wrong reason: a
        // sweep that counts nothing satisfies the second, and the original bug
        // satisfied the first. Two spellings on the Quasar side as well —
        // `q-icon` and `QBadge` name the same component to Vue, and a check
        // derived from the `q-` prefix has to agree with it.
        const quasar = auditOf({
            'Quasar.vue':
                '<template>\n    <q-icon color="grey-7" />\n' +
                '    <QBadge text-color="amber-9" />\n</template>\n',
        });
        assert.equal(
            quasar.quasarColorProps.total,
            2,
            'a palette name on a Quasar component is the decision this metric exists for, ' +
                'in either spelling of the tag',
        );

        const ours = auditOf({
            'Ours.vue':
                '<template>\n    <my-chart color="primary" />\n' +
                '    <AdminKpi bg-color="grey-7" />\n</template>\n',
        });
        assert.equal(
            ours.quasarColorProps.total,
            0,
            "a `color` prop on somebody else's component names that component's own API, " +
                "not Quasar's palette — counting it makes the ratchet answer for props it " +
                'has no claim to',
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
