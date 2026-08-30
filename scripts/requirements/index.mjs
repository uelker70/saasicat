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

    // The chapter table is part of a source file, so it is settled before the
    // document is assembled: the page is what the sources say, and a stale
    // table would otherwise reach the page and the drift report at once,
    // leaving a reader to guess which of the two to believe.
    const files = [];
    for (const file of catalogue.preamble) {
        const spliced = withChapterTable(file.text, catalogue.chapters);
        if (spliced !== null) files.push({ where: file.where, text: await markdown(spliced) });
    }

    return { catalogue, files, text: await markdown(render(catalogue)) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const write = process.argv.includes('--write');
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
