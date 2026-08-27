// What `saasicat codemod v1-project-key` rewrites, and what it deliberately
// only reports.
//
// project-key-history: this file names the retired identifier because it is the
// subject of the codemod it checks.
//
// The line between the two moved four times under review, and the tests below
// are written around where it ended up: an object member is REPORTED, never
// rewritten, because an object literal and a type literal are lexically
// identical in TypeScript and this codemod does not parse. What it rewrites is
// the two forms that need no grammar — the key in a `saas.yaml`, and a query
// part on a `/catalog/` URL.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { removeProjectKey } from '../dist/index.js';

describe('a query parameter the admin API no longer reads', () => {
    test('the only parameter takes the question mark with it', () => {
        const result = removeProjectKey('const u = `${base}/catalog/plans?projectKey=${pk}`;');
        assert.equal(result.text, 'const u = `${base}/catalog/plans`;');
        assert.equal(result.rewritten, 1);
    });

    test('the first of several hands the question mark to the next', () => {
        const result = removeProjectKey(
            'fetch(`${b}/catalog/plans?projectKey=myapp&onlyPublished=true`);',
        );
        assert.equal(result.text, 'fetch(`${b}/catalog/plans?onlyPublished=true`);');
    });

    test('a later one takes its own ampersand', () => {
        const result = removeProjectKey(
            'fetch(`${b}/catalog/plans?onlyPublished=true&projectKey=myapp`);',
        );
        assert.equal(result.text, 'fetch(`${b}/catalog/plans?onlyPublished=true`);');
    });

    test('an interpolation with an ampersand inside it stays whole', () => {
        const result = removeProjectKey(
            'const u = `/catalog/plans?projectKey=${a && b}&locale=de`;',
        );
        assert.equal(result.text, 'const u = `/catalog/plans?locale=de`;');
    });

    test('and so does one holding a nested object', () => {
        // Every `{` counts, not only the one that opens the interpolation. The
        // scan used to close its depth on the nested object's own brace and read
        // the following space as the end of the value, emitting
        // `/catalog/plans : a && b}&locale=de` and calling it a rewrite.
        const result = removeProjectKey(
            'const u = `/catalog/plans?projectKey=${flag ? { x: 1 } : a && b}&locale=de`;',
        );
        assert.equal(result.text, 'const u = `/catalog/plans?locale=de`;');
        assert.equal(result.rewritten, 1);
    });

    test('an interpolation that never closes is reported, not cut', () => {
        const source = 'const u = `/catalog/plans?projectKey=${oops';
        const result = removeProjectKey(source);
        assert.equal(result.text, source);
        assert.equal(result.rewritten, 0);
    });

    test("somebody else's endpoint keeps its parameter, and is reported", () => {
        // Every admin route that read the parameter sat under `/catalog/`. A
        // consumer calling their own `/api/reports?projectKey=` is asking a
        // question this platform never answered, and rewriting it would
        // silently change a request that still works.
        const source = 'fetch(`/api/reports?projectKey=${key}&from=2026`);';
        const result = removeProjectKey(source);
        assert.equal(result.text, source);
        assert.equal(result.rewritten, 0);
        assert.deepEqual(result.undecided, [1], 'one line, one entry to look at');
    });

    test('an occurrence at the very start does not end the scan', () => {
        // `indexOf` returning 0 is a found needle with nothing in front of it,
        // not an absent one. Reading it as absent stopped the scan, and every
        // later query part in the same file went unrewritten.
        const result = removeProjectKey(
            'projectKey=leftover\nconst u = `/catalog/plans?projectKey=x`;',
        );
        assert.match(result.text, /const u = `\/catalog\/plans`;/);
        assert.equal(result.rewritten, 1);
    });
});

describe('an object member is reported, never rewritten', () => {
    // Four attempts at telling an object literal from a type literal, four
    // counter-examples: an interface uses `;`, a type literal may use a
    // newline, TypeScript permits `,` between type members, and
    // `interface E { projectKey: 'app' }` is a valid string-literal type that
    // `tsc` accepts. The two constructs are lexically identical; only the
    // enclosing grammar separates them, and this codemod does not parse.

    const leaves = (source, lines) => {
        const result = removeProjectKey(source);
        assert.equal(result.text, source, 'the source must come back untouched');
        assert.equal(result.rewritten, 0);
        assert.deepEqual(result.undecided, lines);
    };

    test('the endpoint constant', () => {
        leaves("export const E = { apiBase: '/api/v1/admin', projectKey: 'myapp' };", [1]);
    });

    test('a create body', () => {
        leaves("plans.create({ projectKey: 'myapp', planKey: 'STARTER' });", [1]);
    });

    test('a string-literal type member, which `tsc` accepts', () => {
        leaves("interface E { projectKey: 'vereinsfux', apiBase: string }", [1]);
    });

    test('an interface member', () => {
        leaves('interface E {\n    projectKey: string;\n    apiBase: string;\n}', [2]);
    });

    test('a bare-identifier value', () => {
        leaves("const o = { apiBase: '/x', projectKey: PROJECT_KEY };", [1]);
    });

    test('the shorthand form, which used to pass in silence', () => {
        // 46 of these in one consumer repository. An earlier scan required a
        // colon, so they were neither rewritten nor named, and the codemod
        // reported itself done.
        leaves('const o = { apiBase, projectKey, planKey };', [1]);
    });

    test("a consumer's own object", () => {
        leaves("const mine = { projectKey: 'my-own-thing', colour: 'red' };", [1]);
    });

    test('several are reported in the order they appear, once per line', () => {
        const source = [
            "const a = { projectKey: 'x' };",
            'const b = 2;',
            'const c = { projectKey };',
        ].join('\n');
        assert.deepEqual(removeProjectKey(source).undecided, [1, 3]);
    });
});

describe("a longer identifier is somebody else's name", () => {
    // The cut used to start inside one and leave `old_` behind, reporting it as
    // rewritten. It is not this identifier, so it is not this codemod's
    // business — not rewritten and not reported either, or a reader goes
    // looking for something that is not there.

    test('is neither rewritten nor reported', () => {
        const source = "const o = { apiBase: '/x', old_projectKey: 'mine' };";
        const result = removeProjectKey(source);
        assert.equal(result.text, source);
        assert.equal(result.rewritten, 0);
        assert.deepEqual(result.undecided, []);
    });

    test('and neither is a suffix', () => {
        const source = 'const x = { myProjectKeyish: 1, projectKeys: [] };';
        assert.deepEqual(removeProjectKey(source).undecided, []);
    });
});

describe('the catalogue configuration', () => {
    test('loses the top-level key and nothing else', () => {
        const yaml = ['schemaVersion: 1', 'projectKey: myapp', '', 'app:', '    name: MyApp'].join(
            '\n',
        );
        const result = removeProjectKey(yaml, 'yaml');
        assert.equal(result.text, ['schemaVersion: 1', '', 'app:', '    name: MyApp'].join('\n'));
        assert.equal(result.rewritten, 1);
    });

    test('an indented key of the same name is not the top-level one', () => {
        const yaml = ['app:', '    projectKey: something'].join('\n');
        assert.equal(removeProjectKey(yaml, 'yaml').text, yaml);
    });
});
