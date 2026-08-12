#!/usr/bin/env node
// Replaces literal colours in the admin UI with the semantic role tokens.
//
// The human decision happens ONCE, in `colour-map.json`, and it is keyed by the
// pair `<paint job> <literal>` — not by the literal alone. `#fff` is a surface
// under `background` and a foreground under `color`, and a map that cannot tell
// them apart paints white text on white cards.
//
//   node scripts/codemods/colour-to-token.mjs --report
//       What is still literal, grouped by pair, most frequent first. Pairs the
//       map does not cover are listed as UNMAPPED — those are the review queue.
//
//   node scripts/codemods/colour-to-token.mjs --report --context
//       …with file:line and the declaration, for deciding what a pair means.
//
//   node scripts/codemods/colour-to-token.mjs <file> [<file>…]
//       Rewrites those files in place. One file per commit is the intended
//       rhythm: when a visual baseline moves, the wrong thing is a map entry,
//       and a one-file diff says which.
//
//   node scripts/codemods/colour-to-token.mjs --all
//       Every file that has a fully mapped set of sites. Files with unmapped
//       sites are skipped whole and named, because a half-migrated file mixes
//       two vocabularies in one stylesheet.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { colourSites, siteKey } from './lib/style-colours.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const UI_SRC = join(REPO_ROOT, 'packages', 'saas-platform-ui-vue', 'src');
const MAP_PATH = join(dirname(fileURLToPath(import.meta.url)), 'colour-map.json');

/** The token files define the palette; their literals are the point of them. */
const PALETTE_DIR = join(UI_SRC, 'ui', 'theme');

function walk(dir) {
    const found = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) found.push(...walk(full));
        else if (/\.(vue|css)$/.test(entry)) found.push(full);
    }
    return found;
}

function sourceFiles() {
    return walk(UI_SRC).filter((file) => !file.startsWith(PALETTE_DIR));
}

function loadMap() {
    return JSON.parse(readFileSync(MAP_PATH, 'utf8'));
}

/**
 * Rewrites one file's colour literals; returns the new text and what it did.
 *
 * Patches are applied back to front so that every recorded offset still points
 * at the same byte when its turn comes.
 */
function migrate(content, sites, map) {
    const applied = [];
    const skipped = [];
    let next = content;

    for (const site of [...sites].reverse()) {
        const token = map[siteKey(site)];
        if (!token) {
            skipped.push(site);
            continue;
        }
        next = next.slice(0, site.start) + token + next.slice(site.end);
        applied.push(site);
    }
    return { next, applied: applied.reverse(), skipped: skipped.reverse() };
}

function report({ withContext }) {
    const map = loadMap();
    const pairs = new Map();

    for (const file of sourceFiles()) {
        const content = readFileSync(file, 'utf8');
        for (const site of colourSites(file, content)) {
            const key = siteKey(site);
            if (!pairs.has(key)) pairs.set(key, []);
            pairs.get(key).push({ ...site, file: relative(UI_SRC, file) });
        }
    }

    const sorted = [...pairs.entries()].sort((a, b) => b[1].length - a[1].length);
    const unmapped = sorted.filter(([key]) => !map[key]);
    const mapped = sorted.filter(([key]) => map[key]);

    console.log(
        `\n${sorted.reduce((n, [, hits]) => n + hits.length, 0)} colour literals in ${
            new Set(sorted.flatMap(([, hits]) => hits.map((h) => h.file))).size
        } files — ${sorted.length} distinct pairs\n`,
    );
    console.log(`  mapped   ${mapped.length} pairs / ${count(mapped)} sites`);
    console.log(`  UNMAPPED ${unmapped.length} pairs / ${count(unmapped)} sites\n`);

    for (const [key, hits] of unmapped) {
        console.log(`  ${String(hits.length).padStart(4)}×  ${key}`);
        if (!withContext) continue;
        for (const hit of hits) console.log(`          ${hit.file}:${hit.line}  ${hit.property}`);
    }
    console.log('');
}

const count = (entries) => entries.reduce((n, [, hits]) => n + hits.length, 0);

function apply(files) {
    const map = loadMap();
    let changedFiles = 0;
    let changedSites = 0;

    for (const file of files) {
        const content = readFileSync(file, 'utf8');
        const sites = colourSites(file, content);
        if (sites.length === 0) continue;

        const { next, applied, skipped } = migrate(content, sites, map);
        const name = relative(REPO_ROOT, file);

        if (skipped.length > 0) {
            console.log(
                `  skipped ${name} — ${skipped.length} unmapped site(s): ` +
                    `${[...new Set(skipped.map(siteKey))].join(', ')}`,
            );
            continue;
        }
        if (applied.length === 0) continue;

        writeFileSync(file, next);
        changedFiles += 1;
        changedSites += applied.length;
        console.log(`  ${name} — ${applied.length} literal(s) → tokens`);
    }
    console.log(`\n${changedSites} literals in ${changedFiles} files.\n`);
}

const args = process.argv.slice(2);
if (args.includes('--report')) {
    report({ withContext: args.includes('--context') });
} else if (args.includes('--all')) {
    apply(sourceFiles());
} else if (args.length > 0) {
    apply(args.map((a) => resolve(process.cwd(), a)));
} else {
    console.error('Nothing to do. Pass --report, --all, or one or more file paths.');
    process.exit(1);
}
