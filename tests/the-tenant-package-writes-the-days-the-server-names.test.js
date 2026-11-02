// Every day a tenant's page shows is a day the server named (`SC-UI-028`), and
// the application's `formatDate` only decides how it is written. A component of
// `@saasicat/ui-vue-tenant` therefore hands that formatter what `writeDay` makes
// of a day the server handed out, and never a moment of its own: a moment read
// in the browser's zone is the day the browser happens to be in, and an end at
// midnight is the day after the last one it covers.
//
// Two rules, each read off every source file of the package, the directory
// rather than a list:
//
//   1. `formatDate` is called in one place, `day-as-instant.ts`. Anywhere else
//      it is handed on — to `writeDay`, to a child, to `provideWithdrawnFeatures`
//      — and an arrow that passes its own parameter on unchanged is handing it
//      on, not writing a day.
//   2. A date is written with `toLocaleDateString` only inside a function called
//      `formatDate`: the formatter a page defines for itself is the one place it
//      decides how a day looks, and it is handed days through rule 1.
//
// A single-file component is compiled with its template inlined, so a call in
// the template is code this reads as much as a call in the script. A component
// whose shape the compiler cannot inline fails here rather than being skipped.
//
// What this does not see, and stays a question for review: a formatter called
// under another name or through `.call`, `Intl.DateTimeFormat`, and `writeDay`
// handed something that is not a day the server named — a `CalendarDay` is a
// plain string, so a slice of a moment passes for one.

// @requirement SC-UI-028 — Every day a tenant is shown is the installation's day, named by the server

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { compileScript, parse } from 'vue/compiler-sfc';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'packages', 'ui-vue-tenant', 'src');

/** The one file that hands a day to the application's formatter. */
const THE_PLACE = 'day-as-instant.ts';
const FORMATTER = 'formatDate';

/** Every `.vue` and `.ts` under `dir`. */
function sourceFiles(dir = SRC, found = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) sourceFiles(full, found);
        else if (entry.name.endsWith('.vue') || entry.name.endsWith('.ts')) found.push(full);
    }
    return found;
}

/** A source file as TypeScript: a component compiled with its template inlined. */
function codeOf(path, text) {
    if (!path.endsWith('.vue')) return text;
    const { descriptor, errors } = parse(text, { filename: path });
    if (errors.length > 0) throw errors[0];
    if (!descriptor.scriptSetup) {
        throw new Error(`${path} has no <script setup>, so its template cannot be read inlined.`);
    }
    return compileScript(descriptor, { id: 'tenant-days', inlineTemplate: true }).content;
}

/** The name a call calls: `f(…)`, `a.f(…)`, `a?.f(…)` and `a['f'](…)` all call `f`. */
function calleeName(call) {
    const callee = call.expression;
    if (ts.isIdentifier(callee)) return callee.text;
    if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
    if (ts.isElementAccessExpression(callee) && ts.isStringLiteral(callee.argumentExpression)) {
        return callee.argumentExpression.text;
    }
    return null;
}

/** Whether `call` is the whole body of an arrow that passes its one parameter on unchanged. */
function handsItsParameterOn(call) {
    const arrow = call.parent;
    if (!ts.isArrowFunction(arrow) || arrow.body !== call) return false;
    if (arrow.parameters.length !== 1 || call.arguments.length !== 1) return false;
    const [parameter] = arrow.parameters;
    const [argument] = call.arguments;
    return (
        ts.isIdentifier(parameter.name) &&
        ts.isIdentifier(argument) &&
        argument.text === parameter.name.text
    );
}

/** The name a function is declared under: `function f`, `const f = …`, `f: …`, `f() {}`. */
function declaredName(fn) {
    if (fn.name && ts.isIdentifier(fn.name)) return fn.name.text;
    const { parent } = fn;
    if (ts.isVariableDeclaration(parent) && parent.initializer === fn) {
        return ts.isIdentifier(parent.name) ? parent.name.text : null;
    }
    if (ts.isPropertyAssignment(parent) && parent.initializer === fn) {
        return ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name)
            ? parent.name.text
            : null;
    }
    return null;
}

function insideAFormatter(node) {
    for (let at = node.parent; at; at = at.parent) {
        if (ts.isFunctionLike(at) && declaredName(at) === FORMATTER) return true;
    }
    return false;
}

/** What `code` does that the two rules forbid, each with the text of the call. */
function daysWrittenElsewhere(code, { isThePlace = false } = {}) {
    const file = ts.createSourceFile(
        'code.ts',
        code,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
    );
    const found = [];
    const visit = (node) => {
        if (ts.isCallExpression(node)) {
            const name = calleeName(node);
            if (name === FORMATTER && !isThePlace && !handsItsParameterOn(node)) {
                found.push(`calls ${node.getText(file)}`);
            }
            if (name === 'toLocaleDateString' && !insideAFormatter(node)) {
                found.push(`writes a date outside a formatDate: ${node.getText(file)}`);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(file);
    return found;
}

/** A component's source, its template calling the formatter as `template` says. */
const component = (template, script = '') =>
    `<template><span>${template}</span></template>\n` +
    '<script setup lang="ts">\n' +
    'const props = defineProps<{ at: string; day: string; formatDate: (iso: string) => string }>();\n' +
    `${script}\n</script>\n`;

describe('the tenant package', () => {
    test('hands the application’s formatter only the days the server named', () => {
        const files = sourceFiles();
        const offences = files.flatMap((path) =>
            daysWrittenElsewhere(codeOf(path, readFileSync(path, 'utf8')), {
                isThePlace: relative(SRC, path) === THE_PLACE,
            }).map((offence) => `${relative(ROOT, path)}: ${offence}`),
        );
        assert.ok(
            files.some((path) => path.endsWith('.vue')),
            'the components are among the files read',
        );
        assert.ok(
            files.some((path) => relative(SRC, path) === THE_PLACE),
            `${THE_PLACE} is where the rule says it is`,
        );
        assert.deepEqual(offences, []);
    });
});

describe('the rules, on components written to break them', () => {
    test('a call in the template is read as one in the script', () => {
        assert.equal(
            daysWrittenElsewhere(codeOf('Probe.vue', component('{{ formatDate(at) }}'))).length,
            1,
        );
        assert.equal(
            daysWrittenElsewhere(codeOf('Probe.vue', component('{{ writeDay(formatDate, day) }}')))
                .length,
            0,
        );
    });

    test('an arrow may pass its parameter on, and nothing else', () => {
        const forwards = component('', 'const write = (iso: string) => props.formatDate(iso);');
        const slices = component(
            '',
            'const write = (iso: string) => props.formatDate(iso.slice(0, 10));',
        );
        assert.equal(daysWrittenElsewhere(codeOf('Probe.vue', forwards)).length, 0);
        assert.equal(daysWrittenElsewhere(codeOf('Probe.vue', slices)).length, 1);
        assert.equal(daysWrittenElsewhere('features.formatDate(mark.effectiveFrom);').length, 1);
        assert.equal(daysWrittenElsewhere("props['formatDate'](at);").length, 1);
    });

    test('only the one place calls the formatter itself', () => {
        const writeDay = 'export const writeDay = (formatDate, day) => formatDate(day);';
        assert.equal(daysWrittenElsewhere(writeDay, { isThePlace: true }).length, 0);
        assert.equal(daysWrittenElsewhere(writeDay).length, 1);
    });

    test('a date is written with toLocaleDateString only inside a formatDate', () => {
        for (const allowed of [
            'const formatDate = (iso) => new Date(iso).toLocaleDateString();',
            'function formatDate(at) { return at.toLocaleDateString(); }',
            'const fallback = { formatDate: (iso) => new Date(iso).toLocaleDateString() };',
        ]) {
            assert.deepEqual(daysWrittenElsewhere(allowed), [], allowed);
        }
        for (const refused of [
            'provide(key, (iso) => new Date(iso).toLocaleDateString());',
            'function label(at) { return at.toLocaleDateString(); }',
        ]) {
            assert.equal(daysWrittenElsewhere(refused).length, 1, refused);
        }
    });
});
