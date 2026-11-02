// A day the server hands a reader is one of three kinds, and each has a function
// that names it: the day a moment falls on in the installation's zone
// (`dayInZone`), the days on either side of a moment (`daysAround`), and a day
// somebody picked and the platform stored as its UTC midnight (`pickedDayOf`).
// Cutting the first ten characters off an ISO timestamp produces a fourth kind
// nobody chose — the day in UTC — which reads as the day before for a tenant
// east of it at midnight, and names the first day after a period where a
// sentence means the last one in it (`SC-UI-028`). Every refusal that named a
// day the wrong way was written like that.
//
// So no source under `packages/nest/src` cuts a day out of text: no
// `.slice(0, 10)`, `.substring(0, 10)` or `.substr(0, 10)`, and no
// `.split('T')`. Read as syntax rather than as text, so a comment that names
// the forbidden shape does not count and a line break inside the call does not
// hide it; the files come from the directory.
//
// What this does not see, and stays a question for review: a day assembled from
// `getUTCFullYear()`/`getUTCMonth()`/`getUTCDate()` — the period arithmetic
// reads those for good reasons, so they are not refused — and a day cut by a
// helper written outside this package.

// @requirement SC-UI-028 — Every day a tenant is shown is the installation's day, named by the server

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'packages', 'nest', 'src');

/** The methods that cut the first ten characters off a text when called with `(0, 10)`. */
const CUTS = new Set(['slice', 'substring', 'substr']);

/** Every `.ts` under `dir`. */
function sourceFiles(dir = SRC, found = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) sourceFiles(full, found);
        else if (entry.name.endsWith('.ts')) found.push(full);
    }
    return found;
}

const isNumber = (node, value) => ts.isNumericLiteral(node) && Number(node.text) === value;

/** Whether `call` cuts a day out of a timestamp's text. */
function cutsADay(call) {
    const callee = call.expression;
    if (!ts.isPropertyAccessExpression(callee)) return false;
    const name = callee.name.text;
    const args = call.arguments;
    if (CUTS.has(name)) return args.length === 2 && isNumber(args[0], 0) && isNumber(args[1], 10);
    if (name === 'split')
        return args.length >= 1 && ts.isStringLiteralLike(args[0]) && args[0].text === 'T';
    return false;
}

/** Each place in `code` that cuts a day out of text, with its line and its text. */
function daysCut(code) {
    const file = ts.createSourceFile(
        'code.ts',
        code,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
    );
    const found = [];
    const visit = (node) => {
        if (ts.isCallExpression(node) && cutsADay(node)) {
            const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
            found.push(`${line + 1}: ${node.getText(file)}`);
        }
        ts.forEachChild(node, visit);
    };
    visit(file);
    return found;
}

describe('the server', () => {
    test('names every day by its kind rather than cutting it out of a timestamp', () => {
        const files = sourceFiles();
        const cuts = files.flatMap((path) =>
            daysCut(readFileSync(path, 'utf8')).map((cut) => `${relative(ROOT, path)}:${cut}`),
        );
        assert.ok(files.length > 100, `the package's sources are read (${files.length} files)`);
        assert.deepEqual(cuts, []);
    });
});

describe('the rule, on sources written to break it', () => {
    test('refuses each way of cutting a day out of text', () => {
        for (const cut of [
            'const day = at.toISOString().slice(0, 10);',
            'const day = notice.effectiveAt.substring(0, 10);',
            'const day = at.toISOString().substr(0, 10);',
            "const [day] = at.toISOString().split('T');",
            'const day = at\n    .toISOString()\n    .slice(\n        0,\n        10,\n    );',
        ]) {
            assert.equal(daysCut(cut).length, 1, cut);
        }
    });

    test('leaves the named days, other slices and the prose about them alone', () => {
        for (const fine of [
            'const day = dayInZone(at, zone);',
            'const day = pickedDayOf(stored);',
            'const head = list.slice(0, 3);',
            'const rest = text.slice(10);',
            "const parts = key.split('/');",
            '// never `.slice(0, 10)` here',
        ]) {
            assert.deepEqual(daysCut(fine), [], fine);
        }
    });
});
