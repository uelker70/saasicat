#!/usr/bin/env node
// Snaps every literal font size in the admin UI onto the type scale.
//
// Twenty-three sizes, five of them half-pixels (9.5 / 10.5 / 11.5 / 12.5 /
// 13.5). Nobody chose 11.5px over 11px on purpose; it arrived from a design
// tool, and the next author who saw it had no way to tell a decision from an
// accident — so they invented 12.5px, and so on. The scale ends that by making
// the choice "which step", not "which number".
//
//   node scripts/codemods/font-size-to-scale.mjs --report
//   node scripts/codemods/font-size-to-scale.mjs --all
//   node scripts/codemods/font-size-to-scale.mjs <file> [<file>…]
//
// It rewrites `font-size:` AND the size inside the `font:` shorthand, because
// half the mono captions in this package are written as `font: 500 10px …` and
// leaving those behind would keep a second vocabulary alive in the same files.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { styleBlocks, declarations } from './lib/stylesheets.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const UI_SRC = join(REPO_ROOT, 'packages', 'ui-vue', 'src');
/**
 * The files that DEFINE the scale. Everything else consumes it — including the
 * theme's own component sheets, which are as much a consumer of `--sa-text-*`
 * as any page is. Excluding the whole theme directory (which is right for the
 * colour codemod, since nothing there paints) would have left the shell chrome
 * as the last place in the package still writing `12.5px`.
 */
const DEFINES_THE_SCALE = /(^|[\\/])tokens\.[\w.]+\.css$/;

/**
 * Every size in the package, and the step it belongs to.
 *
 * The half-pixels round to the nearer neighbour — an optical difference of half
 * a pixel that costs five sizes to keep. The larger jumps are named because
 * they are visible: `16px → lg` loses a pixel on seven headings, `20px → xl`
 * loses two on two, and both are the price of a ladder somebody can hold in
 * their head.
 */
const STEP_FOR = {
    '9px': '2xs',
    '9.5px': '2xs',
    '10px': '2xs',
    '10.5px': 'xs',
    '11px': 'xs',
    '11.5px': 'sm',
    '12px': 'sm',
    '12.5px': 'md',
    '13px': 'md',
    '13.5px': 'md',
    '14px': 'lg',
    '14.5px': 'lg',
    '15px': 'lg',
    '16px': 'lg',
    '17px': 'xl',
    '18px': 'xl',
    '20px': 'xl',
    '22px': '2xl',
    '1.4rem': '2xl',
    '28px': '3xl',
    '32px': '4xl',
    '38px': '4xl',
    // The package's only fluid size, on the onboarding headline. It spans
    // 25.6px–38.4px, which is the 4xl step with extra steps at the ends; a
    // second sizing mechanism for one heading is not worth the explanation.
    'clamp(1.6rem, 3vw, 2.4rem)': '4xl',
};

/** `font: <weight> <size> <family>` — the shorthand this package actually uses. */
const FONT_SHORTHAND = /^\s*(\d{3}\s+)?([\d.]+(?:px|rem)|clamp\([^)]*\))(\s|$)/;

function walk(dir) {
    const found = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) found.push(...walk(full));
        else if (/\.(vue|css)$/.test(entry)) found.push(full);
    }
    return found;
}

const sourceFiles = () => walk(UI_SRC).filter((file) => !DEFINES_THE_SCALE.test(file));

/**
 * Sites where a literal size is set, as `{ start, end, size }` in the original
 * text. Offsets are absolute so a `.vue` file can be patched without touching
 * its template.
 */
function sizeSites(file, content) {
    const sites = [];
    for (const block of styleBlocks(file, content)) {
        for (const declaration of declarations(block.text)) {
            const property = declaration.property.toLowerCase();
            const base = block.offset + declaration.valueStart;

            if (property === 'font-size') {
                const size = declaration.value.trim();
                if (size.startsWith('var(')) continue;
                const offset = declaration.value.indexOf(size);
                sites.push({ start: base + offset, end: base + offset + size.length, size });
                continue;
            }
            if (property !== 'font') continue;

            const match = FONT_SHORTHAND.exec(declaration.value);
            if (!match) continue;
            const size = match[2];
            const offset = declaration.value.indexOf(size, (match[1] ?? '').length);
            sites.push({ start: base + offset, end: base + offset + size.length, size });
        }
    }
    return sites.sort((a, b) => a.start - b.start);
}

function report() {
    const counts = new Map();
    for (const file of sourceFiles()) {
        for (const site of sizeSites(file, readFileSync(file, 'utf8'))) {
            const key = `${site.size} → ${STEP_FOR[site.size] ?? 'UNMAPPED'}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
    }
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    console.log(
        `\n${rows.reduce((n, [, c]) => n + c, 0)} literal sizes, ${rows.length} distinct\n`,
    );
    for (const [key, count] of rows) console.log(`  ${String(count).padStart(4)}×  ${key}`);
    console.log('');
}

function apply(files) {
    let changedFiles = 0;
    let changedSites = 0;

    for (const file of files) {
        const content = readFileSync(file, 'utf8');
        const sites = sizeSites(file, content);
        if (sites.length === 0) continue;

        const unmapped = sites.filter((site) => !STEP_FOR[site.size]);
        if (unmapped.length > 0) {
            console.log(
                `  skipped ${relative(REPO_ROOT, file)} — no step for ` +
                    `${[...new Set(unmapped.map((s) => s.size))].join(', ')}`,
            );
            continue;
        }

        let next = content;
        for (const site of [...sites].reverse()) {
            next =
                next.slice(0, site.start) +
                `var(--sa-text-${STEP_FOR[site.size]})` +
                next.slice(site.end);
        }
        writeFileSync(file, next);
        changedFiles += 1;
        changedSites += sites.length;
        console.log(`  ${relative(REPO_ROOT, file)} — ${sites.length} size(s) → the scale`);
    }
    console.log(`\n${changedSites} sizes in ${changedFiles} files.\n`);
}

const args = process.argv.slice(2);
if (args.includes('--report')) report();
else if (args.includes('--all')) apply(sourceFiles());
else if (args.length > 0) apply(args.map((a) => resolve(process.cwd(), a)));
else {
    console.error('Nothing to do. Pass --report, --all, or one or more file paths.');
    process.exit(1);
}
