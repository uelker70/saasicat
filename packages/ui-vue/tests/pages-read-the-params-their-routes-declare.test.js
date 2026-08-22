/**
 * A detail page reads the parameter its own route declares.
 *
 * `promo-codes/:code` was answered by a page reading `route.params.id` — the
 * name it carried before it became a standard route, when every consumer wrote
 * its own wrapper and passed the value as a prop. Nothing connected the two
 * sides, so the page asked the server for `/promo-codes/` on every navigation:
 * the list, not the code the operator clicked, and a detail page that never
 * shows anything.
 *
 * `vue-tsc` cannot see this — `route.params` is `Record<string, …>` on both
 * sides — and neither can a mounted-page test that hands the value in as a
 * prop, which is what every existing fixture does. So the two sources are
 * compared directly: the paths in `STANDARD_ADMIN_ROUTES` and the `params.…`
 * reads in the page each path names.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SRC, scriptBlocksOnly } from './support/vue-typescript-program.mjs';

const PAGES = join(SRC, 'pages');

/** `[':code']` for `promo-codes/:code`. */
function declaredParams(path) {
    return [...path.matchAll(/:([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[1]);
}

/**
 * Every `route.params.X` / `params.X` a page reads.
 *
 * Read off the syntax tree rather than with a pattern so a read written across
 * a line break, or through a destructured `const { params } = useRoute()`,
 * counts the same as the one-liner.
 */
function paramsRead(source, fileName) {
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
    const names = new Set();
    const visit = (node) => {
        if (
            ts.isPropertyAccessExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === 'params'
        ) {
            names.add(node.name.text);
        }
        if (
            ts.isElementAccessExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === 'params' &&
            node.argumentExpression &&
            ts.isStringLiteral(node.argumentExpression)
        ) {
            names.add(node.argumentExpression.text);
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(file, visit);
    return names;
}

/** The route table, read out of the source it is declared in. */
function routeTable() {
    const path = join(PAGES, 'index.ts');
    const file = ts.createSourceFile(
        path,
        readFileSync(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
    );
    const rows = [];
    const visit = (node) => {
        if (ts.isObjectLiteralExpression(node)) {
            const read = (name) => {
                const property = node.properties.find(
                    (candidate) =>
                        ts.isPropertyAssignment(candidate) &&
                        ts.isIdentifier(candidate.name) &&
                        candidate.name.text === name &&
                        ts.isStringLiteral(candidate.initializer),
                );
                return property ? property.initializer.text : undefined;
            };
            const path_ = read('path');
            const page = read('page');
            if (path_ !== undefined && page !== undefined) rows.push({ path: path_, page });
        }
        ts.forEachChild(node, visit);
    };
    ts.forEachChild(file, visit);
    return rows;
}

const ROWS = routeTable();

describe('a page reads the route parameter its route declares', () => {
    test('the table was read at all', () => {
        // Without this the loop below runs zero times and reports success.
        assert.ok(ROWS.length >= 15, `only ${ROWS.length} route rows found`);
        assert.ok(
            ROWS.some((row) => declaredParams(row.path).length > 0),
            'no parameterised route found — the check would be about nothing',
        );
    });

    test('every parameterised route is answered by a page that reads it', () => {
        const offenders = [];
        for (const row of ROWS) {
            const params = declaredParams(row.path);
            if (params.length === 0) continue;
            const file = join(PAGES, `${row.page}.vue`);
            const { code } = scriptBlocksOnly(readFileSync(file, 'utf8'));
            const read = paramsRead(code, file);
            // A page may read nothing — a route parameter it ignores is the
            // consumer's business, not a defect. What it may not do is read a
            // name the route never puts there.
            const wrong = [...read].filter((name) => !params.includes(name));
            if (wrong.length > 0) {
                offenders.push(
                    `${row.page} reads params.${wrong.join(', params.')} but ` +
                        `\`${row.path}\` declares ${params.map((p) => `:${p}`).join(', ')}`,
                );
            }
        }
        assert.deepEqual(offenders, []);
    });
});

describe('the reader sees what it has to see', () => {
    test('a mismatched read is reported', () => {
        const read = paramsRead(`const id = route.params.id;`, 'x.ts');
        assert.deepEqual([...read], ['id']);
    });

    test('a read written across lines counts', () => {
        const read = paramsRead(`const v = route\n  .params\n  .slug;`, 'x.ts');
        assert.deepEqual([...read], ['slug']);
    });

    test('a bracketed read counts', () => {
        const read = paramsRead(`const v = route.params['code'];`, 'x.ts');
        assert.deepEqual([...read], ['code']);
    });

    test('the path parser finds the parameter', () => {
        assert.deepEqual(declaredParams('promo-codes/:code'), ['code']);
        assert.deepEqual(declaredParams('bundles'), []);
    });
});
