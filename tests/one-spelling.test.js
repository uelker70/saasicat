import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// One spelling of the product name (AP1 §1.2, AP6 rule 26).
//
// `SaaSiCat` in prose and type names, `saasicat` in packages, files and the npm
// scope, `SAASICAT_` in constants. The three spellings that used to sit beside
// them — `SaasPlatform`, `Saasicat`, `SaaSicat` — are what this file refuses:
// 1.0 removed the last of them, and a reader who meets one again has no way to
// tell a second product from an unfinished rename.
//
// The scope is every tracked text file, not `packages/*/src` alone: a README or
// a test name is read by the same stranger. Two kinds of file legitimately
// still carry an old spelling, and each says so where it stands rather than in
// a list here:
//   - history by role — `CHANGELOG.md` and `.changeset/*.md` are release notes
//     and describe what WAS; `pnpm-lock.yaml` is tool-owned.
//   - history by declaration — a file that names the old identifiers on purpose
//     (the migration guide, the codemod's rename table and its tests) carries
//     `naming-history` in its first lines, or `_namingHistory` as a JSON key.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const OLD_SPELLINGS = /\b(SaasPlatform|Saasicat|SaaSicat)[A-Za-z0-9_]*/g;
const TEXT = /\.(ts|mts|cts|js|mjs|cjs|vue|md|json|ya?ml|tpl|prisma|sql|css|scss|html|txt)$/;
const HISTORY_BY_ROLE = (path) =>
    path.endsWith('CHANGELOG.md') || path.startsWith('.changeset/') || path === 'pnpm-lock.yaml';
const DECLARATION_WINDOW = 20;

/** Whether a file declares, in its head, that it names the old spellings on purpose. */
export function declaresHistory(text) {
    const head = text.split('\n', DECLARATION_WINDOW).join('\n');
    return head.includes('naming-history') || /"_namingHistory"\s*:/.test(head);
}

/** The old spellings a text carries, with their line numbers. */
export function findOldSpellings(text) {
    const hits = [];
    text.split('\n').forEach((line, index) => {
        for (const match of line.matchAll(OLD_SPELLINGS)) {
            hits.push({ line: index + 1, word: match[0] });
        }
    });
    return hits;
}

function trackedTextFiles() {
    return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
        .split('\0')
        .filter((path) => path && TEXT.test(path) && !HISTORY_BY_ROLE(path));
}

describe('the product has one spelling', () => {
    const files = trackedTextFiles();

    test('the scan reaches the repository', () => {
        // Every assertion below is vacuously true on an empty list.
        assert.ok(files.length > 500, `only ${files.length} tracked text files found`);
        assert.ok(
            files.some((f) => f.startsWith('packages/nest/src/')),
            'nest sources missing',
        );
        assert.ok(
            files.some((f) => f.startsWith('docs/')),
            'docs missing',
        );
    });

    test('no tracked file carries an old spelling without declaring it', () => {
        const offenders = [];
        let declared = 0;
        for (const path of files) {
            const text = readFileSync(join(ROOT, path), 'utf8');
            if (declaresHistory(text)) {
                declared += 1;
                continue;
            }
            for (const { line, word } of findOldSpellings(text)) {
                offenders.push(`${path}:${line} ${word}`);
            }
        }
        assert.deepEqual(
            offenders,
            [],
            'these files spell the product the pre-1.0 way — use SaaSiCat / saasicat / SAASICAT_, ' +
                'or declare `naming-history` at the top if the old name is the subject',
        );
        // The declaration must be in use, or a typo in the marker would turn
        // every declared file into an offender at once — or, if the marker
        // were matched too loosely, silently excuse them all.
        assert.ok(declared <= 6, `${declared} files declare history`);
    });
});

describe('the scanner itself', () => {
    test('flags each old spelling as a whole identifier', () => {
        const hits = findOldSpellings(
            'import { SaasPlatformModule } from "x";\nconst a: SaasicatPersistenceAdapter = 1;\n// SaaSicat adapters\nconst ok = SAASICAT_PUBLIC_ROUTE_KEY; const fine = "saasicat";',
        );
        assert.deepEqual(
            hits.map((h) => h.word),
            ['SaasPlatformModule', 'SaasicatPersistenceAdapter', 'SaaSicat'],
        );
    });

    test('does not flag the three accepted forms', () => {
        assert.deepEqual(findOldSpellings('SaaSiCat saasicat SAASICAT_X @saasicat/nest'), []);
    });

    test('a declaration has to be in the head of the file', () => {
        const tail = `${'\n'.repeat(DECLARATION_WINDOW + 1)}naming-history`;
        assert.equal(declaresHistory(tail), false);
        assert.equal(declaresHistory('<!-- naming-history: names the old identifiers -->'), true);
        assert.equal(declaresHistory('{\n  "_namingHistory": "rename table"\n}'), true);
    });
});
