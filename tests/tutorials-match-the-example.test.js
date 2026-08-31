// A tutorial that is not tested is wrong in three months, and a wrong tutorial
// is worse than none — it is the first thing somebody reads.
//
// The four tutorials build `examples/notesapp`, so the code they print is not
// written twice: a block that claims to come from the example says so in an
// annotation right above it, and this file holds the two against each other. A
// change to the example that leaves the tutorial behind fails here, which is
// the direction the drift actually runs.
//
// What this does NOT do is run the tutorials in a throwaway directory against
// published packages. That layer — `files`, export maps, CJS stubs, the
// scaffolder's templates — is the pre-release smoke, and it is where the five
// defects before `1.0.0-rc.2` came from. Saying so here rather than implying
// coverage this file does not have.

// @requirement SC-COMP-014 — The example application is kept in step with the platform
// @requirement SC-READ-001 — Someone deciding whether to depend on SaaSiCat can judge what is tested

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TUTORIALS = join(ROOT, 'docs/tutorial');

const ANNOTATION = '<!-- from: ';

/**
 * Blocks that claim a source file, as `{ file, source, code }`.
 *
 * The annotation sits immediately above the fence, where an author editing the
 * block can see it — not in a table inside this test, which is the same defect
 * one level up.
 */
export function claimedBlocks(text, file) {
    const lines = text.split('\n');
    const blocks = [];

    for (const [index, line] of lines.entries()) {
        if (!line.startsWith(ANNOTATION)) continue;
        const source = line.slice(ANNOTATION.length, line.indexOf(' -->')).trim();
        // Prettier puts a blank line between a comment and the fence below it.
        let fence = index + 1;
        while (lines[fence]?.trim() === '') fence += 1;
        assert.ok(
            lines[fence]?.startsWith('```'),
            `${file}:${index + 1}: annotation with no block under it`,
        );

        const close = lines.indexOf('```', fence + 1);
        assert.ok(close !== -1, `${file}:${fence + 1}: block never closes`);
        blocks.push({ file, source, code: lines.slice(fence + 1, close) });
    }
    return blocks;
}

/**
 * Strips trailing markup from a word, by walking backwards.
 *
 * A pattern with a quantifier over a character class would backtrack on a long
 * run of them, and the repository forbids that on text it did not write.
 */
function trimPunctuation(word) {
    const MARKUP = '`\'".,)';
    let end = word.length;
    while (end > 0 && MARKUP.includes(word[end - 1])) end -= 1;
    return word.slice(0, end);
}

/** Every non-empty line, trimmed — indentation differs between a file and a snippet. */
function significantLines(code) {
    return code.map((line) => line.trim()).filter(Boolean);
}

function tutorials() {
    return readdirSync(TUTORIALS)
        .filter((name) => name.endsWith('.md'))
        .sort()
        .map((name) => ({ name, text: readFileSync(join(TUTORIALS, name), 'utf8') }));
}

describe('the tutorials print what the example actually contains', () => {
    const pages = tutorials();
    const blocks = pages.flatMap(({ name, text }) => claimedBlocks(text, name));

    test('the sweep finds the tutorials and their claims', () => {
        // Vacuously true on an empty list, which is what a renamed directory
        // and a changed annotation both produce.
        assert.equal(pages.length, 4, `found ${pages.length} tutorials`);
        assert.ok(blocks.length >= 3, `only ${blocks.length} annotated blocks found`);
    });

    test('every annotated block appears in the file it names', () => {
        const offenders = [];
        for (const { file, source, code } of blocks) {
            let target;
            try {
                target = significantLines(readFileSync(join(ROOT, source), 'utf8').split('\n'));
            } catch {
                offenders.push(`${file}: ${source} does not exist`);
                continue;
            }

            const wanted = significantLines(code);
            const start = target.indexOf(wanted[0]);
            const found =
                start !== -1 && wanted.every((line, offset) => target[start + offset] === line);
            if (!found) {
                const firstMissing = wanted.find((line) => !target.includes(line)) ?? wanted[0];
                offenders.push(
                    `${file}: not in ${source} — first line that differs: ${firstMissing}`,
                );
            }
        }
        assert.deepEqual(
            offenders,
            [],
            `The tutorial and the example have drifted apart.\n${offenders.join('\n')}`,
        );
    });

    test('every saasicat command a tutorial gives exists', () => {
        const cli = readFileSync(join(ROOT, 'packages/cli/bin/saasicat.js'), 'utf8');
        const offenders = [];
        for (const { name, text } of pages) {
            for (const line of text.split('\n')) {
                const at = line.indexOf('saasicat ');
                if (at === -1 || line.includes('create-saasicat')) continue;
                // Prose names commands in backticks (`saasicat init`), scripts
                // do not; both are a claim that the command exists.
                const [word] = line
                    .slice(at + 'saasicat '.length)
                    .split(' ')
                    .filter(Boolean);
                const command = trimPunctuation(word ?? '');
                if (!command || command.startsWith('-')) continue;
                if (!cli.includes(`'${command}'`)) {
                    offenders.push(`${name}: no such command "${command}"`);
                }
            }
        }
        assert.deepEqual(offenders, [], offenders.join('\n'));
    });
});
