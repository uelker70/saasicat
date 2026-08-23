#!/usr/bin/env node
// Generates the pages under `docs/reference/` that are read off the sources.
//
// The rule from `gen-options-reference.mjs` applies to all of them: a reference
// page that is maintained by hand describes what someone remembered, and the
// gap between that and the code is invisible until a reader acts on it.
//
//   node scripts/gen-docs/index.mjs            print what would change
//   node scripts/gen-docs/index.mjs --write    write the files
//
// Requires the packages to be built — `@saasicat/core`'s catalogues are read
// from `dist/`, the same way the test suites read everything else.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

import * as errorCodes from './error-codes.mjs';
import * as designTokens from './design-tokens.mjs';
import * as ports from './ports.mjs';
import * as uiPrimitives from './ui-primitives.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

export const PAGES = [errorCodes, designTokens, ports, uiPrimitives];

/** Everything a generator may read, resolved once. */
export async function context() {
    return {
        root: ROOT,
        core: await import(new URL('../../packages/core/dist/index.js', import.meta.url).href),
    };
}

/**
 * Renders every page, formatted the way the repository formats Markdown.
 *
 * Prettier owns the formatting of everything under `docs/`, including these —
 * so the generator produces what Prettier would, rather than producing
 * something `format:check` then rewrites and the drift test then rejects. The
 * two gates would otherwise contradict each other, and the loser would be
 * whoever ran them in the wrong order.
 */
export async function renderAll() {
    const shared = await context();
    const rendered = new Map();
    for (const page of PAGES) {
        const options = await resolveConfig(join(ROOT, page.TARGET));
        const text = await page.render(shared);
        rendered.set(page.TARGET, await format(text, { ...options, parser: 'markdown' }));
    }
    return rendered;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const write = process.argv.includes('--write');
    for (const [target, text] of await renderAll()) {
        const path = join(ROOT, target);
        const current = safeRead(path);
        if (current === text) {
            process.stdout.write(`${target}: unchanged\n`);
            continue;
        }
        if (write) {
            writeFileSync(path, text);
            process.stdout.write(`${target}: written (${text.split('\n').length} lines)\n`);
        } else {
            process.stdout.write(`${target}: would change (${text.split('\n').length} lines)\n`);
        }
    }
}

function safeRead(path) {
    try {
        return readFileSync(path, 'utf8');
    } catch {
        return null;
    }
}
