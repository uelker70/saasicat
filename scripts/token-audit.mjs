#!/usr/bin/env node
// Token audit — the worklist for the design-system migration, and the data the
// ratchets in `packages/saas-platform-ui-vue/tests/design-token-budget.test.js`
// measure against.
//
// The admin UI ships a token layer AND hundreds of literal colours, dozens of
// distinct pixel values and 23 font sizes. That combination is worse than
// having no tokens: a reader cannot tell which values were a decision and which
// were a guess, so every new page guesses again.
//
// This script does not judge. It counts, groups and points at file:line, so the
// migration has a list to work through and a number to drive down.
//
//   node scripts/token-audit.mjs              summary table
//   node scripts/token-audit.mjs --json       machine-readable (used by the test)
//   node scripts/token-audit.mjs --detail     every occurrence with file:line
//   node scripts/token-audit.mjs --top=20     n most frequent values per category

import { readdirSync, readFileSync, statSync } from 'node:fs';

import { declarations, styleBlocks } from './codemods/lib/stylesheets.mjs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI_SRC = join(REPO_ROOT, 'packages', 'saas-platform-ui-vue', 'src');

/**
 * The directory that DEFINES the palette rather than consuming it. Literals are
 * what it is for, so counting them would make the target unreachable by
 * construction.
 *
 * A directory rather than a list of file names: the theme is a set of layered
 * files now, and a name list would silently start counting the next one added.
 * Everything outside it — every page, every component — is a consumer.
 */
const TOKEN_DEFINITION_DIR = join(UI_SRC, 'ui', 'theme');

/** Hairlines and zero — a scale for these would be ceremony, not clarity. */
const ALLOWED_PX = new Set(['0px', '1px', '2px']);

/**
 * Quasar's five bands, and their `max-width` counterparts.
 *
 * The rule is WHICH values, not how many. A package that only needs three of
 * them is not in debt — a package that invents a fourth is, because a component
 * that reflows at 980px inside an app whose grid moves at 1024px produces a
 * 44px band where the two disagree.
 */
const QUASAR_BREAKPOINTS = new Set([
    '0',
    '600',
    '1024',
    '1440',
    '1920',
    '599.98',
    '1023.98',
    '1439.98',
    '1919.98',
]);

const CATEGORIES = {
    // #rgb, #rrggbb, #rrggbbaa
    hexColor: /#[0-9a-fA-F]{3,8}\b/g,
    // rgb()/rgba()/hsl()/hsla() with LITERAL channels. `rgb(var(--x) / .06)` is
    // a token being used, not a value being invented, and counting it would
    // make an alpha derived from a theme-aware ink indistinguishable from a
    // hard-coded shadow — the first is the goal, the second is the debt.
    functionalColor: /\b(?:rgba?|hsla?)\((?![^)]*var\()[^)]*\)/g,
    // A named colour is a literal too, and it hid from the two above for the
    // whole migration: `color: white` is neither a hex nor a function, so the
    // audit read 0 while one button still painted itself. Anchored on a
    // colour-bearing property so that `.text-white` in a selector and a font
    // called "Black" are not findings.
    namedColor:
        /(?:^|[;{])\s*(?:color|background(?:-color)?|border(?:-[a-z]+)?-color|outline-color|fill|stroke)\s*:\s*([^;}\n]*(?<![\w-])(?:white|black|red|green|blue|orange|yellow|purple|grey|gray|silver|maroon|navy|teal|olive|lime|aqua|fuchsia)(?![\w-])[^;}\n]*)/gi,
    pixelValue: /\b\d{1,4}(?:\.\d+)?px\b/g,
    // Filled by the declaration pass; see SCALE_PROPERTY below.
    scalePixel: /(?!)/g,
    dimensionPixel: /(?!)/g,
    fontSize: /font-size:\s*([^;}\n]+)/g,
    // Fractional too. Quasar's upper bounds are `599.98px` and friends — the
    // 0.02px step back that stops `max-width` and the next `min-width` both
    // matching at an integer viewport. An integer-only pattern read 0 the
    // moment the package adopted them, which is the most flattering possible
    // way for this number to be wrong.
    breakpoint: /@media[^{]*?\(\s*(?:min|max)-width:\s*(\d+(?:\.\d+)?)px/g,
    // `var(--x, var(--x))` — a fallback to itself, i.e. no fallback at all
    selfReferencingVar: /var\((--[\w-]+),\s*var\(\1\)\)/g,
    // Filled by the script pass rather than by the block loop below; it needs a
    // different source, not a different pattern.
    scriptColor: /(?!)/g,
    alphaConcat: /(?!)/g,
};

/**
 * A colour tint built by gluing two hex digits onto a colour: `accent + '15'`,
 * or `` `${accent}33` ``.
 *
 * Its own category because it is the half of the script-colour debt that
 * counting literals cannot see. When the five hard-coded accent palettes moved
 * into the theme, `scriptColors` went to 0 and two backgrounds went fully
 * TRANSPARENT at the same time: the trick needs a six-digit hex, and
 * `var(--sa-color-identity-2)18` is not a colour. The number was right and the
 * screen was broken, so the number was measuring the wrong thing.
 *
 * There is no second reason to append exactly two hex digits to an expression,
 * so this needs no allow-list — and the replacement is one call:
 * `color-mix(in srgb, <colour> n%, transparent)` works for a hex, for an
 * `rgb()`, and for a `var()`, which is the whole point.
 */
const ALPHA_CONCAT = /(?:\+\s*['"`][0-9a-fA-F]{2}['"`])|(?:\$\{[^}]+\}[0-9a-fA-F]{2}(?=['"`]))/g;

/**
 * Properties a SCALE already has the answer for.
 *
 * The split matters more than either number. `distinctPixelValues` counted
 * `padding: 6px` and `max-width: 1100px` as the same kind of debt and asked for
 * both to collapse onto twelve values — but a drawer being 280px wide is a
 * layout decision taken once, not a rung anybody should reuse, and inventing a
 * scale for it is the ceremony this file already rejects for hairlines.
 *
 * So the question is asked twice, and the half that a scale governs is held to
 * ZERO literals rather than to "at most twelve distinct" — a strictly stronger
 * rule on the properties where a scale means something.
 */
const SCALE_PROPERTY =
    /^(?:padding|margin|gap|row-gap|column-gap|inset|top|right|bottom|left|border(?:-[a-z]+)?-radius|letter-spacing|word-spacing|text-indent)(?:-[a-z-]+)?$/;

function walk(dir, predicate) {
    const found = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) found.push(...walk(full, predicate));
        else if (predicate(entry)) found.push(full);
    }
    return found;
}

/**
 * Colour literals in SCRIPT, which no codemod may touch and no stylesheet rule
 * can reach.
 *
 * These are the palettes a component keeps in TypeScript and applies through a
 * `:style` binding — a plan accent, a diff row, a status dot. They were out of
 * the migration's declared scope on purpose (the codemod is forbidden from
 * touching a template or a script), and the cost of leaving them unmeasured was
 * that a diff dialog kept fixed light rows in dark mode and nothing said so.
 *
 * Counted, not forbidden: an inline style can read `var(--sa-color-…)`, so the
 * fix is per site and per judgement. The ratchet stops the number growing.
 */
function scriptSource(file, content) {
    if (file.endsWith('.ts')) return content;
    return [...content.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
}

/** Extracts the `<style>` blocks of an SFC; returns whole content for `.css`. */
function styleSource(file, content) {
    if (file.endsWith('.css')) return [{ text: content, offset: 0 }];
    const blocks = [];
    const re = /<style[^>]*>([\s\S]*?)<\/style>/g;
    let match;
    while ((match = re.exec(content)) !== null) {
        blocks.push({ text: match[1], offset: match.index + match[0].indexOf(match[1]) });
    }
    return blocks;
}

function lineOf(content, index) {
    return content.slice(0, index).split('\n').length;
}

export function audit() {
    const files = walk(
        UI_SRC,
        (name) => name.endsWith('.vue') || name.endsWith('.css') || name.endsWith('.ts'),
    );
    const findings = Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, []]));
    const styleShare = [];
    // How much was actually looked at, counted independently of what was found.
    // Every finding count can legitimately fall to zero once the migration is
    // done, so "no findings" cannot tell a finished job from a broken sweep.
    const reach = { files: 0, styleBlocks: 0 };

    for (const file of files) {
        const rel = relative(REPO_ROOT, file);
        const content = readFileSync(file, 'utf8');
        const isTokenDefinition = file.startsWith(TOKEN_DEFINITION_DIR);
        reach.files += 1;
        reach.styleBlocks += styleSource(file, content).length;

        if (!isTokenDefinition) {
            const script = scriptSource(file, content)
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/^\s*\/\/.*$/gm, '');
            for (const match of script.matchAll(CATEGORIES.hexColor)) {
                findings.scriptColor.push({ file: rel, line: 0, value: match[0] });
            }
            for (const match of script.matchAll(CATEGORIES.functionalColor)) {
                findings.scriptColor.push({ file: rel, line: 0, value: match[0] });
            }
            // Over the WHOLE file, not only the script block: the same trick is
            // written straight into a `:style` binding in the template, and
            // that is where one of the two live instances sat.
            // Comments stripped for the same reason the script sweep strips
            // them: the sentence explaining this rule contains an example of
            // what it forbids, and prose is not paint. Blanked rather than
            // deleted so `line` still points at the real line.
            const prose = content.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
            for (const match of prose.matchAll(ALPHA_CONCAT)) {
                findings.alphaConcat.push({
                    file: rel,
                    line: lineOf(content, match.index),
                    value: match[0],
                });
            }
        }

        if (file.endsWith('.vue')) {
            const total = content.split('\n').length;
            const styleLines = styleSource(file, content).reduce(
                (sum, block) => sum + block.text.split('\n').length,
                0,
            );
            styleShare.push({ file: rel, total, styleLines, share: styleLines / total });
        }

        // Self-referencing vars can sit anywhere, including inline styles.
        for (const match of content.matchAll(CATEGORIES.selfReferencingVar)) {
            findings.selfReferencingVar.push({
                file: rel,
                line: lineOf(content, match.index),
                value: match[0],
            });
        }

        if (isTokenDefinition) continue;

        // Per DECLARATION, not per regex hit: only the property can say whether
        // a scale has the answer, and the shared parser is what the codemods
        // read too.
        for (const block of styleBlocks(file, content)) {
            for (const declaration of declarations(block.text)) {
                const scaled = SCALE_PROPERTY.test(declaration.property.toLowerCase());
                for (const match of declaration.value.matchAll(CATEGORIES.pixelValue)) {
                    if (ALLOWED_PX.has(match[0])) continue;
                    const where = {
                        file: rel,
                        line: lineOf(content, block.offset + declaration.valueStart + match.index),
                        value: match[0],
                        property: declaration.property,
                    };
                    findings[scaled ? 'scalePixel' : 'dimensionPixel'].push(where);
                }
            }
        }

        for (const block of styleSource(file, content)) {
            for (const [category, pattern] of Object.entries(CATEGORIES)) {
                if (category === 'selfReferencingVar') continue;
                for (const match of block.text.matchAll(pattern)) {
                    const value = (match[1] ?? match[0]).trim();
                    if (category === 'pixelValue' && ALLOWED_PX.has(value)) continue;
                    // A `var(--sa-…)` is the goal, not a finding.
                    if (value.startsWith('var(')) continue;
                    findings[category].push({
                        file: rel,
                        line: lineOf(content, block.offset + match.index),
                        value,
                    });
                }
            }
        }
    }

    return { findings, styleShare, reach };
}

export function summarise({ findings, styleShare, reach }) {
    const distinct = (list) => new Set(list.map((f) => f.value)).size;
    const files = (list) => new Set(list.map((f) => f.file)).size;

    return {
        reach,
        hexColors: { total: findings.hexColor.length, files: files(findings.hexColor) },
        functionalColors: { total: findings.functionalColor.length },
        namedColors: { total: findings.namedColor.length },
        scriptColors: { total: findings.scriptColor.length, files: files(findings.scriptColor) },
        alphaConcats: { total: findings.alphaConcat.length, files: files(findings.alphaConcat) },
        scalePixels: { total: findings.scalePixel.length, distinct: distinct(findings.scalePixel) },
        dimensionPixels: {
            total: findings.dimensionPixel.length,
            distinct: distinct(findings.dimensionPixel),
        },
        distinctFontSizes: distinct(findings.fontSize),
        distinctBreakpoints: distinct(findings.breakpoint),
        offScaleBreakpoints: {
            total: findings.breakpoint.filter((f) => !QUASAR_BREAKPOINTS.has(f.value)).length,
        },
        selfReferencingVars: {
            total: findings.selfReferencingVar.length,
            files: files(findings.selfReferencingVar),
        },
        worstStyleShare: Math.max(0, ...styleShare.map((s) => s.share)),
    };
}

/** One call for consumers of this module (the ratchet test). */
export function auditSummary() {
    return summarise(audit());
}

// ── CLI ──────────────────────────────────────────────────────────────────
// Guarded, so importing this module from the ratchet test does not print a
// report as a side effect.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    runCli(process.argv.slice(2));
}

function runCli(args) {
    const result = audit();
    const summary = summarise(result);

    if (args.includes('--json')) {
        console.log(JSON.stringify({ summary, ...result }, null, 2));
        return;
    }

    const topFlag = args.find((a) => a.startsWith('--top='));
    const topN = topFlag ? Number(topFlag.split('=')[1]) : 10;

    console.log('\nDesign-token audit — packages/saas-platform-ui-vue/src\n');
    console.log(
        `  hard-coded hex colours     ${summary.hexColors.total} in ${summary.hexColors.files} files`,
    );
    console.log(`  rgb()/hsl() literals       ${summary.functionalColors.total}`);
    console.log(`  named colours              ${summary.namedColors.total}`);
    console.log(
        `  colours in script          ${summary.scriptColors.total} in ${summary.scriptColors.files} files`,
    );
    console.log(
        `  hex-alpha concatenations   ${summary.alphaConcats.total} in ${summary.alphaConcats.files} files`,
    );
    console.log(
        `  px on scale properties     ${summary.scalePixels.total} (${summary.scalePixels.distinct} distinct)`,
    );
    console.log(
        `  px as one-off dimensions   ${summary.dimensionPixels.total} (${summary.dimensionPixels.distinct} distinct)`,
    );
    console.log(`  distinct font sizes        ${summary.distinctFontSizes}`);
    console.log(
        `  distinct breakpoints       ${summary.distinctBreakpoints} (${summary.offScaleBreakpoints.total} off Quasar's scale)`,
    );
    console.log(
        `  self-referencing var()     ${summary.selfReferencingVars.total} in ${summary.selfReferencingVars.files} files`,
    );
    console.log(`  worst <style> share        ${(summary.worstStyleShare * 100).toFixed(1)}%`);

    const printTop = (label, list) => {
        const counts = new Map();
        for (const f of list) counts.set(f.value, (counts.get(f.value) ?? 0) + 1);
        const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
        if (sorted.length === 0) return;
        console.log(`\n  ${label} — ${topN} most frequent:`);
        for (const [value, count] of sorted) {
            console.log(`    ${String(count).padStart(4)}×  ${value}`);
        }
    };

    printTop('hex colours', result.findings.hexColor);
    printTop('font sizes', result.findings.fontSize);
    printTop('pixel values', result.findings.pixelValue);

    const worst = [...result.styleShare].sort((a, b) => b.share - a.share).slice(0, topN);
    console.log(`\n  <style> share — ${topN} heaviest SFCs:`);
    for (const s of worst) {
        console.log(
            `    ${(s.share * 100).toFixed(0).padStart(3)}%  ${String(s.styleLines).padStart(4)}/${String(s.total).padEnd(5)} ${s.file}`,
        );
    }

    if (args.includes('--detail')) {
        for (const [category, list] of Object.entries(result.findings)) {
            if (list.length === 0) continue;
            console.log(`\n── ${category} (${list.length}) ──`);
            for (const f of list) console.log(`   ${f.file}:${f.line}  ${f.value}`);
        }
    }

    console.log('');
}
