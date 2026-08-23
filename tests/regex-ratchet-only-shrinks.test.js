import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// `regex-ratchet.json` lists the files in which the regular-expression rules
// are still warnings — the findings that were there the day the rules
// arrived. A ratchet, so two things have to hold: the list never grows, and
// every file on it still has a finding. A file whose findings are fixed has
// to leave the list, or the list quietly becomes a permanent allowlist.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ratchet = JSON.parse(readFileSync(join(ROOT, 'regex-ratchet.json'), 'utf8'));

describe('the regex ratchet', () => {
    test('names only files that exist', () => {
        const gone = ratchet.files.filter((file) => !existsSync(join(ROOT, file)));
        assert.deepEqual(gone, [], 'remove these from regex-ratchet.json');
    });

    test('has a subject', () => {
        assert.ok(
            ratchet.files.length > 0,
            'an empty ratchet is the rules at full strength — delete the file',
        );
    });

    test('every listed file still carries a finding', () => {
        // Run the rules at error strength over the listed files only: one
        // that reports nothing has been fixed and must leave the list.
        // ESLint exits 1 when it reports — which is the expected outcome here.
        let out;
        try {
            out = execFileSync(
                process.execPath,
                [
                    join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js'),
                    '--no-inline-config',
                    '--rule',
                    'regexp/no-super-linear-backtracking: error',
                    '--rule',
                    'regexp/no-super-linear-move: error',
                    '--rule',
                    "no-restricted-syntax: [error, {selector: \"NewExpression[callee.name='RegExp'] > TemplateLiteral.arguments:first-child[expressions.length>0]\", message: x}, {selector: \"NewExpression[callee.name='RegExp'] > BinaryExpression.arguments:first-child[operator='+']\", message: x}, {selector: \"NewExpression[callee.name='RegExp'] > Identifier.arguments:first-child\", message: x}]",
                    '-f',
                    'json',
                    ...ratchet.files,
                ],
                { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
            ).toString();
        } catch (err) {
            out = String(err.stdout ?? '');
        }
        const reported = new Set(
            JSON.parse(out)
                .filter((f) =>
                    f.messages.some(
                        (m) => /^regexp\//.test(m.ruleId) || m.ruleId === 'no-restricted-syntax',
                    ),
                )
                .map((f) => f.filePath.slice(ROOT.length + 1)),
        );
        const clean = ratchet.files.filter((file) => !reported.has(file));
        assert.deepEqual(
            clean,
            [],
            'these files are clean now — remove them from regex-ratchet.json',
        );
    });
});
