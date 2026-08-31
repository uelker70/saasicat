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

// @requirement SC-COMP-004 — The upgrade command reports what it cannot decide rather than guessing
// @requirement SC-COMP-005 — A step no command can take is named as a step the operator takes

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

    test('a fragment survives the parameter in front of it', () => {
        // `#` ends the query. Reading it as part of the value took `#details`
        // with the parameter — a client-side target the consumer meant to keep.
        const result = removeProjectKey('const u = `/catalog/plans?projectKey=x#details`;');
        assert.equal(result.text, 'const u = `/catalog/plans#details`;');
        assert.equal(result.rewritten, 1);
    });

    test('a call expression is simple enough to keep', () => {
        // The form the real consumers write. If this stopped being rewritten
        // the rule below would be too narrow to be worth having.
        const result = removeProjectKey(
            'const u = `${b}/catalog/plans?projectKey=${encodeURIComponent(pk)}`;',
        );
        assert.equal(result.text, 'const u = `${b}/catalog/plans`;');
        assert.equal(result.rewritten, 1);
    });
});

describe('a value the scanner would have to lex is left alone', () => {
    // Finding the end of `${flag ? { x: "}" } : a && b}` means lexing
    // JavaScript: a brace inside a string, a comment or a regular expression is
    // text, not structure. Three rounds of hand-rolled brace matching each met
    // a new counter-example. Requiring that there is nothing to match removes
    // the question rather than answering it, and costs nothing real — every
    // value in both consumer repositories is a literal or a plain `${…}`.

    const leftAlone = (source) => {
        const result = removeProjectKey(source);
        assert.equal(result.text, source);
        assert.equal(result.rewritten, 0);
    };

    test('a nested object inside the interpolation', () => {
        leftAlone('const u = `/catalog/plans?projectKey=${flag ? { x: 1 } : b}&locale=de`;');
    });

    test('a brace inside a string inside the interpolation', () => {
        leftAlone('const u = `/catalog/plans?projectKey=${flag ? { x: "}" } : b}&locale=de`;');
    });

    test('an interpolation that never closes', () => {
        leftAlone('const u = `/catalog/plans?projectKey=${oops');
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

    test('and the word in one of its query values does not make it ours', () => {
        // The path decides, not the URL. `/api/reports?next=/catalog/plans` is
        // the consumer's endpoint carrying the word in a value, and the
        // substring test read the whole string.
        const source = 'fetch(`/api/reports?next=/catalog/plans&projectKey=x`);';
        const result = removeProjectKey(source);
        assert.equal(result.text, source);
        assert.equal(result.rewritten, 0);
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

describe('the report names lines of the file a person will open', () => {
    // The report is this codemod's main output, so a wrong line number sends
    // the reader to the wrong place. Lines used to be counted against the
    // rewritten copy — and under `--dry-run` nothing is written at all, so they
    // named lines of a file that did not exist.

    test('a rewrite that shortens the file does not shift the lines it reports', () => {
        const source = [
            'const u = `/catalog/plans?projectKey=${',
            '    PROJECT_KEY',
            '}`;',
            'const own = { projectKey: 1 };',
        ].join('\n');
        const result = removeProjectKey(source);
        assert.equal(result.rewritten, 1, 'the multi-line interpolation is still simple');
        assert.deepEqual(result.undecided, [4], "the consumer's own object is on line 4");
    });

    test('and a parameter that was removed is not also reported', () => {
        const result = removeProjectKey("const u = '/catalog/plans?projectKey=x';");
        assert.equal(result.rewritten, 1);
        assert.deepEqual(result.undecided, []);
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
