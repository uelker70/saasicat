// What `saasicat codemod v1-project-key` does, and what it deliberately does not.
//
// project-key-history: this file names the retired identifier because it is the
// subject of the codemod it checks.
//
// A removal is riskier than a rename: `projectKey` is an ordinary property
// name, and deleting a consumer's own field would be data loss the codemod
// cannot see. So the interesting cases here are as much about what survives as
// about what goes.

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
        const result = removeProjectKey('fetch(`${b}/plans?onlyPublished=true&projectKey=myapp`);');
        assert.equal(result.text, 'fetch(`${b}/plans?onlyPublished=true`);');
    });

    test('an interpolation with an ampersand inside it stays whole', () => {
        const result = removeProjectKey('const u = `/plans?projectKey=${a && b}&locale=de`;');
        assert.equal(result.text, 'const u = `/plans?locale=de`;');
    });

    test('a word that merely ends in the needle is not a parameter', () => {
        const source = 'const x = { myProjectKey: 1 };';
        assert.equal(removeProjectKey(source).text, source);
    });
});

describe('an object member, when the object says whose it is', () => {
    test('the endpoint constant loses it and keeps its shape', () => {
        const result = removeProjectKey(
            "export const E = { apiBase: '/api/v1/admin', projectKey: 'myapp' };",
        );
        assert.equal(result.text, "export const E = { apiBase: '/api/v1/admin' };");
        assert.deepEqual(result.undecided, []);
    });

    test('a multi-line literal keeps its newline and indent', () => {
        const result = removeProjectKey(
            ['const c = {', "    projectKey: 'myapp',", '    vatRate: 19,', '};'].join('\n'),
        );
        assert.equal(result.text, ['const c = {', '    vatRate: 19,', '};'].join('\n'));
    });

    test('a last member without a trailing comma takes the separating one', () => {
        const result = removeProjectKey(
            ['const c = {', '    vatRate: 19,', "    projectKey: 'myapp'", '};'].join('\n'),
        );
        assert.equal(result.text, ['const c = {', '    vatRate: 19', '};'].join('\n'));
    });

    test('a create body is decidable through the key beside it', () => {
        const result = removeProjectKey(
            "await plans.create({ projectKey: 'myapp', planKey: 'STARTER' });",
        );
        assert.equal(result.text, "await plans.create({ planKey: 'STARTER' });");
    });
});

describe("an object that could be the consumer's own", () => {
    // The counter-check for the whole design: a codemod that removed this too
    // would pass every test above and still corrupt a consumer's code.
    const MINE = "const mine = { projectKey: 'my-own-thing', colour: 'red' };";

    test('is left exactly as it was', () => {
        assert.equal(removeProjectKey(MINE).text, MINE);
        assert.equal(removeProjectKey(MINE).rewritten, 0);
    });

    test('and is reported by line, so nobody has to search for it', () => {
        const result = removeProjectKey(`const a = 1;\n${MINE}\n`);
        assert.deepEqual(result.undecided, [2]);
    });

    test('several are reported in the order they appear', () => {
        const result = removeProjectKey([MINE, 'const b = 2;', MINE].join('\n'));
        assert.deepEqual(result.undecided, [1, 3]);
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
