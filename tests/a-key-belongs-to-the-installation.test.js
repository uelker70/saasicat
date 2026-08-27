import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// `projectKey` does not come back. project-key-history: this file names the
// retired identifier because it is its subject.
//
// One installation serves one application, so a plan key, a bundle key, a
// feature key and a quota key are unique for the whole installation. The column
// that suggested otherwise is gone, and so is the query parameter, the DTO
// field, the config key and the DI token that carried it.
//
// This is a ratchet rather than a style rule. Removing something leaves no
// trace: the next feature that adds `projectKey` to one table in a corner
// reintroduces exactly the confusion #236 was opened about, and nothing else in
// the build would notice — the tests would pass, the schema would load, and the
// only symptom would be a reader asking the same question again two years
// later.
//
// The scope is every tracked text file, because the identifier reached every
// layer: the DDL, both adapters, the platform, the admin UI, the CLI templates,
// the example app and the documentation. Two kinds of file legitimately still
// carry it, and each says so where it stands rather than in a list here:
//   - history by role — `CHANGELOG.md` and `.changeset/*.md` are release notes
//     and describe what WAS; `pnpm-lock.yaml` is tool-owned.
//   - history by declaration — a file whose subject IS the retired identifier
//     (this test, the migration SQL, the codemod that removes it, the upgrade
//     guide) carries `project-key-history` in its first lines.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The identifier in every spelling it was written in.
 *
 * `project_key` and `PROJECT_KEY` are in here because a reintroduction is at
 * least as likely to arrive as a column name or a template token as in camel
 * case — and `--project-key`, the CLI flag, is the fourth. One alternation, no
 * nested quantifier: the input is a repository's own files, but the rule in
 * `~/.claude/CLAUDE.md` does not make an exception for those.
 */
export const RETIRED = /\b(projectKey|project_key|PROJECT_KEY|project-key)\b/g;

const TEXT = /\.(ts|mts|cts|js|mjs|cjs|vue|md|json|ya?ml|tpl|prisma|sql|css|scss|html|txt)$/;
const HISTORY_BY_ROLE = (path) =>
    path.endsWith('CHANGELOG.md') || path.startsWith('.changeset/') || path === 'pnpm-lock.yaml';
const DECLARATION_WINDOW = 20;

/** Whether a file declares, in its head, that the retired identifier is its subject. */
export function declaresProjectKeyHistory(text) {
    return text.split('\n', DECLARATION_WINDOW).join('\n').includes('project-key-history');
}

/** The occurrences a text carries, with their line numbers. */
export function findRetiredIdentifier(text) {
    const hits = [];
    text.split('\n').forEach((line, index) => {
        for (const match of line.matchAll(RETIRED)) {
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

describe('a key belongs to the installation, not to a project', () => {
    const files = trackedTextFiles();

    test('the scan reaches the repository', () => {
        // Every assertion below is vacuously true on an empty list, and this
        // guard's whole value is that it looks everywhere the column reached.
        assert.ok(files.length > 500, `only ${files.length} tracked text files found`);
        for (const prefix of [
            'packages/spec/',
            'packages/core/',
            'packages/nest/src/',
            'packages/adapter-prisma/src/',
            'packages/adapter-drizzle/src/',
            'packages/ui-vue/src/',
            'packages/cli/',
            'examples/notesapp/',
            'docs/',
        ]) {
            assert.ok(
                files.some((path) => path.startsWith(prefix)),
                `${prefix} is not in the scan`,
            );
        }
    });

    test('the scan reads the shipped DDL, where the column actually lived', () => {
        // The narrower version of the check above: a `.sql` extension missing
        // from `TEXT` would leave the reference schema unread while every
        // assertion still passed.
        assert.ok(
            files.includes('packages/spec/sql/reference-schema.postgres.sql'),
            'the reference schema is not in the scan',
        );
    });

    test('no tracked file carries the retired identifier without declaring it', () => {
        const offenders = [];
        let declared = 0;
        for (const path of files) {
            const text = readFileSync(join(ROOT, path), 'utf8');
            if (declaresProjectKeyHistory(text)) {
                declared += 1;
                continue;
            }
            for (const { line, word } of findRetiredIdentifier(text)) {
                offenders.push(`${path}:${line} ${word}`);
            }
        }
        assert.deepEqual(
            offenders,
            [],
            'a plan, bundle, feature or quota key is unique for the installation — there is no ' +
                'project above it. Take the field out, or declare `project-key-history` at the ' +
                'top if the retired identifier is the subject of the file',
        );
        // The declaration must be in use, or a typo in the marker would turn
        // every declared file into an offender at once — or, if the marker were
        // matched too loosely, silently excuse them all.
        // Ten today: this test, the migration SQL and the test that applies it
        // twice, the codemod with its unit and command tests, the CLI barrel and
        // bin that name that command, the upgrade guide, and the changeset
        // describing it.
        assert.ok(declared >= 1 && declared <= 10, `${declared} files declare history`);
    });

    test('the rule is not vacuous: it refuses each spelling', () => {
        // The counter-check. Without it this file passes on a repository where
        // the pattern matches nothing at all.
        for (const spelling of ['projectKey', 'project_key', 'PROJECT_KEY', 'project-key']) {
            assert.deepEqual(
                findRetiredIdentifier(`const a = 1;\nconst b = { ${spelling}: 'x' };`),
                [{ line: 2, word: spelling }],
                `${spelling} slipped through`,
            );
        }
    });

    test('and it does not refuse a word that merely contains one', () => {
        assert.deepEqual(findRetiredIdentifier('const myProjectKeyish = 1;'), []);
        assert.deepEqual(findRetiredIdentifier('const projectKeys = 1;'), []);
    });

    test('a declaration excuses the file it is in, and only in its head', () => {
        assert.equal(declaresProjectKeyHistory('// project-key-history\nconst a = 1;'), true);
        assert.equal(
            declaresProjectKeyHistory(`${'\n'.repeat(40)}// project-key-history`),
            false,
            'a marker buried below the head must not excuse the file',
        );
    });
});
