// @requirement SC-UI-012 — The interface works on desktop, tablet and phone

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// `justify-content` is main-axis, so its meaning flips with `flex-direction`.
// A base rule that centres a column of cells is centring them vertically; the
// moment a modifier switches that cell to `row` and inherits the same
// declaration, it centres horizontally instead — and any padding or indent that
// positioned the content is silently defeated.
//
// This shipped: the plan list gained `justify-content: center` on its base cell
// so rows would be equally tall, and the sub-row name cell — which is `row` —
// lost the 32px indent that ties a draft version to its parent plan. The tree
// elbow pointed at nothing. Nothing failed, because the visual fixture renders
// no sub-rows.
//
// So the guard is static: a rule that overrides `flex-direction` must say what
// it wants on the main axis, rather than inheriting a value that meant
// something else.

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

function filesWithStyles() {
    const found = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) walk(full);
            else if (/\.(vue|css)$/.test(full)) found.push(full);
        }
    };
    walk(SRC);
    return found;
}

/** Rule blocks as `{ selector, body }`, comments stripped so they cannot match. */
function rules(source) {
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
    return [...withoutComments.matchAll(/(?<=^|[{}])([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
        selector: m[1].trim(),
        body: m[2],
    }));
}

/** Whether one of the body's declarations is for exactly `prop`. */
const declares = (body, prop) =>
    body.split(';').some((declaration) => {
        const colon = declaration.indexOf(':');
        return colon !== -1 && declaration.slice(0, colon).trim() === prop;
    });

describe('a rule that changes flex-direction states its own main-axis alignment', () => {
    const files = filesWithStyles();

    test('the sweep found the stylesheets', () => {
        // Every assertion below is vacuously true on an empty list.
        assert.ok(files.length >= 40, `only ${files.length} files with styles found`);
        // By file name rather than by directory: PlanList has moved once
        // already (4.1 put it in `features/plan/`), and pinning the folder made
        // this fail for a reason that has nothing to do with what it checks.
        assert.ok(
            files.some((f) => f.endsWith('PlanList.vue')),
            'PlanList is not among the files checked — it is the case this guard exists for',
        );
    });

    test('no rule flips flex-direction while inheriting justify-content', () => {
        const offenders = [];

        for (const file of files) {
            const parsed = rules(readFileSync(file, 'utf8'));

            // A rule is only at risk if some OTHER rule in the same stylesheet
            // could hand it a `justify-content` — i.e. one whose selector is a
            // prefix of this one. Modifiers are written as
            // `.a > .cell--x` against a base `.a > .cell`, so a plain
            // startsWith on the trimmed selector catches the real shape without
            // resolving the cascade.
            const centring = parsed.filter(
                (r) => declares(r.body, 'justify-content') && declares(r.body, 'flex-direction'),
            );

            for (const rule of parsed) {
                if (!declares(rule.body, 'flex-direction')) continue;
                if (declares(rule.body, 'justify-content')) continue;

                const inheritedFrom = centring.find(
                    (base) =>
                        base.selector !== rule.selector &&
                        rule.selector.startsWith(base.selector) &&
                        // The base must set a DIFFERENT direction, or the
                        // inherited value still means what it meant.
                        !sameDirection(base.body, rule.body),
                );

                if (inheritedFrom) {
                    offenders.push(
                        `${relative(SRC, file)}: "${rule.selector}" flips flex-direction but ` +
                            `inherits justify-content from "${inheritedFrom.selector}", where it ` +
                            `meant the other axis`,
                    );
                }
            }
        }

        assert.deepEqual(offenders, [], 'main-axis alignment inherited across a direction change');
    });
});

function sameDirection(a, b) {
    const of = (body) => body.match(/flex-direction\s*:\s*([a-z-]+)/)?.[1];
    return of(a) === of(b);
}
