#!/usr/bin/env node
// Builds `docs/requirements.md` from `requirements/`, and checks the sources.
//
//   node scripts/requirements/index.mjs            check, and say what would change
//   node scripts/requirements/index.mjs --write     check, then write the document
//
// Reads no build output and imports nothing from `packages/`, so it runs in a
// fresh clone before anything is installed — apart from Prettier, which formats
// the result the way the repository formats every other Markdown file.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

import { readCatalogue } from './parse.mjs';
import { scanTests, unproven } from './proof.mjs';
import { render, withChapterTable } from './render.mjs';
import { check } from './check.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const TARGET = 'docs/requirements.md';

/**
 * The catalogue as it should appear on disk.
 *
 * Formatted with Prettier for the same reason the reference pages are: the
 * repository's `format:check` owns `docs/`, and a generator that produced
 * anything else would leave two gates contradicting each other, with the
 * outcome decided by whoever ran them in which order.
 */
export async function renderCatalogue(root = ROOT) {
    const catalogue = readCatalogue(root);
    const options = await resolveConfig(join(root, TARGET));
    const markdown = (text) => format(text, { ...options, parser: 'markdown' });

    // The chapter table is part of a source file, so it is settled *before* the
    // document is assembled, and the document is then assembled from the
    // settled text. Rendering the page from what was on disk instead leaves one
    // run producing two outputs that disagree, and `--write` needing a second
    // run to converge — which somebody eventually does not do.
    const files = [];
    const preamble = [];
    for (const file of catalogue.preamble) {
        const spliced = withChapterTable(file.text, catalogue.chapters);
        if (spliced === null) {
            preamble.push(file);
            continue;
        }
        const text = (await markdown(spliced)).trimEnd();
        files.push({ where: file.where, text: `${text}\n` });
        preamble.push({ ...file, text });
    }

    return { catalogue, files, text: await markdown(render({ ...catalogue, preamble })) };
}

/**
 * Every requirement with its state, because the page shows only the exceptions.
 *
 * An ordinary entry carries no marker, which is right for a document — a dot on
 * three hundred and eighty-seven entries would hide the twelve that are not
 * ordinary. It is wrong for the question "show me all of them", which then has
 * to be answered by reading absence, and reading absence is how the wrapped
 * marker went unnoticed for a day.
 *
 * Proof has three answers, not two. A promise nothing names is owed one; a
 * draft, a retired entry and one not yet delivered are owed nothing, which is a
 * different thing from having been proved.
 */
export function listing(root) {
    const catalogue = readCatalogue(root);
    const named = scanTests(root);
    const owed = new Set(unproven(catalogue.entries, named));
    return catalogue.entries.map((entry) => ({
        id: entry.id,
        state: entry.status === 'current' && !entry.delivered ? 'pending' : entry.status,
        proof: named.has(entry.id) ? 'proved' : owed.has(entry.id) ? 'owed' : 'not owed',
        tests: named.get(entry.id) ?? [],
        title: entry.title,
    }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const write = process.argv.includes('--write');
    if (process.argv.includes('--list')) {
        for (const row of listing(ROOT)) {
            process.stdout.write(
                `${row.id.padEnd(14)}${row.state.padEnd(11)}${row.proof.padEnd(10)}` +
                    `${row.tests.join(' ') || row.title}\n`,
            );
        }
        process.exit(0);
    }

    const { catalogue, files, text } = await renderCatalogue();
    const problems = check(catalogue);

    for (const problem of problems) process.stderr.write(`${problem}\n`);
    if (problems.length) {
        process.stderr.write(`\n${problems.length} problem(s) in requirements/\n`);
        process.exitCode = 1;
    }

    for (const file of [...files, { where: TARGET, text }]) {
        const path = join(ROOT, file.where);
        if (safeRead(path) === file.text) {
            process.stdout.write(`${file.where}: unchanged\n`);
        } else if (problems.length) {
            process.stdout.write(`${file.where}: not written — fix the problems above\n`);
        } else if (write) {
            writeFileSync(path, file.text);
            process.stdout.write(
                `${file.where}: written (${file.text.split('\n').length} lines)\n`,
            );
        } else {
            process.stdout.write(`${file.where}: would change\n`);
        }
    }
    if (!problems.length) {
        process.stdout.write(
            `${catalogue.entries.length} requirements in ${catalogue.chapters.length} chapters\n`,
        );
    }
}

function safeRead(path) {
    try {
        return readFileSync(path, 'utf8');
    } catch {
        return null;
    }
}
