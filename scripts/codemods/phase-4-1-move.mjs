#!/usr/bin/env node
// The 4.1 move: `git mv` by table, then every relative import recomputed.
//
// Two steps, and the second is the one that cannot be done by hand — the
// package holds several hundred relative imports, and a move invalidates every
// one that crosses a moved file in either direction: the importer may have
// moved, the target may have moved, or both.
//
// The table lives beside this file as JSON rather than inline. A 119-file move
// written as `git mv` lines is a diff nobody can check; written as a table, the
// reviewable question is whether each row is right.
//
// Deliberately not a general codemod. It runs once, and afterwards it is a
// record of what happened — which is also why it prints what it did rather than
// working silently.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PKG = join(REPO, 'packages', 'saas-platform-ui-vue');
const SRC = join(PKG, 'src');
const plan = JSON.parse(readFileSync(join(REPO, 'scripts/codemods/phase-4-1-move.json'), 'utf8'));

/** Every file under a directory, repo-relative to `src/`. */
function filesUnder(dir) {
    const out = [];
    const walk = (d) => {
        for (const entry of readdirSync(d)) {
            const full = join(d, entry);
            if (statSync(full).isDirectory()) walk(full);
            else out.push(relative(SRC, full).split('\\').join('/'));
        }
    };
    if (existsSync(dir)) walk(dir);
    return out;
}

// ---------------------------------------------------------------------------
// 1. The complete old → new map, directories expanded to their files.
// ---------------------------------------------------------------------------

const moves = new Map(Object.entries(plan.moves));
for (const [from, to] of Object.entries(plan.moveDirectories)) {
    for (const file of filesUnder(join(SRC, from))) {
        moves.set(file, `${to}/${file.slice(from.length + 1)}`);
    }
}

const missing = [...moves.keys()].filter((from) => !existsSync(join(SRC, from)));
if (missing.length > 0) {
    console.error(`✗ ${missing.length} entries name a file that does not exist:`);
    for (const m of missing) console.error(`    ${m}`);
    process.exit(1);
}

// Everything under a directory that must disappear has to be in the table.
const mustMove = ['components', 'pages-standard'].flatMap((top) => filesUnder(join(SRC, top)));
const uncovered = mustMove.filter((f) => !moves.has(f));
if (uncovered.length > 0) {
    console.error(`✗ ${uncovered.length} file(s) would be left behind in a directory that goes:`);
    for (const f of uncovered) console.error(`    ${f}`);
    process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Move.
// ---------------------------------------------------------------------------

for (const [from, to] of moves) {
    mkdirSync(dirname(join(SRC, to)), { recursive: true });
    execFileSync('git', ['mv', join(SRC, from), join(SRC, to)], { cwd: REPO });
}
console.log(`moved ${moves.size} file(s)`);

// ---------------------------------------------------------------------------
// 3. Recompute every relative import.
// ---------------------------------------------------------------------------
//
// A specifier is rewritten when it resolves to a file the table moved. The
// importer's own new location decides the new relative path, so an import
// between two files that BOTH moved is handled by the same rule — which is the
// case a hand-written search-and-replace gets wrong.

/** What a specifier points at, as a path relative to `src/`, or null. */
function resolveSpecifier(fromFileOld, specifier) {
    if (!specifier.startsWith('.')) return null;
    const target = posix.normalize(posix.join(posix.dirname(fromFileOld), specifier));
    return target.startsWith('..') ? null : target;
}

/** `.js` in a specifier means the `.ts` beside it — the NodeNext convention. */
function candidates(target) {
    return [target, target.replace(/\.js$/, '.ts'), target.replace(/\.js$/, '.tsx')];
}

const SPECIFIER = /(from\s+|import\s*\(\s*|import\s+)(['"])(\.[^'"]*)\2/g;
let rewritten = 0;
let touched = 0;

for (const file of filesUnder(SRC)) {
    const abs = join(SRC, file);
    if (!/\.(ts|vue|js|mjs)$/.test(file)) continue;

    // The path this file had BEFORE the move, so its specifiers resolve.
    const oldSelf = [...moves].find(([, to]) => to === file)?.[0] ?? file;
    const source = readFileSync(abs, 'utf8');
    let changes = 0;

    const next = source.replace(SPECIFIER, (whole, lead, quote, spec) => {
        const target = resolveSpecifier(oldSelf, spec);
        if (target === null) return whole;

        const hit = candidates(target).find((c) => moves.has(c));
        if (!hit) {
            // The target did not move, but this file may have — then the same
            // target needs a different relative path from here.
            if (oldSelf === file) return whole;
            const stillThere = candidates(target).find((c) => existsSync(join(SRC, c)));
            if (!stillThere) return whole;
            const rebased = posix.relative(posix.dirname(file), target);
            const out = rebased.startsWith('.') ? rebased : `./${rebased}`;
            if (out === spec) return whole;
            changes += 1;
            return `${lead}${quote}${out}${quote}`;
        }

        // Keep the extension the specifier used: `.js` for TS sources, the real
        // extension for `.vue` and assets.
        const moved = moves.get(hit);
        const withExtension = hit.endsWith('.ts') ? moved.replace(/\.ts$/, '.js') : moved;
        const rebased = posix.relative(posix.dirname(file), withExtension);
        const out = rebased.startsWith('.') ? rebased : `./${rebased}`;
        if (out === spec) return whole;
        changes += 1;
        return `${lead}${quote}${out}${quote}`;
    });

    if (changes > 0) {
        writeFileSync(abs, next);
        rewritten += changes;
        touched += 1;
    }
}

console.log(`rewrote ${rewritten} specifier(s) in ${touched} file(s)`);
