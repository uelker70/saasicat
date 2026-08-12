#!/usr/bin/env node
// Token audit — the worklist for the design-system migration, and the data the
// ratchets in `tests-component/design-token-budget.test.ts` measure against.
//
// The admin UI ships a token file AND 500+ literal colours, 70+ distinct pixel
// values and 20 font sizes. That combination is worse than having no tokens: a
// reader cannot tell which values were a decision and which were a guess, so
// every new page guesses again.
//
// This script does not judge. It counts, groups and points at file:line, so the
// migration has a list to work through and a number to drive down.
//
//   node scripts/token-audit.mjs              summary table
//   node scripts/token-audit.mjs --json       machine-readable (used by the test)
//   node scripts/token-audit.mjs --detail     every occurrence with file:line
//   node scripts/token-audit.mjs --top=20     n most frequent values per category

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UI_SRC = join(REPO_ROOT, 'packages', 'saas-platform-ui-vue', 'src');

/**
 * Files that DEFINE the palette rather than consume it. Literals are what they
 * are for, so counting them would make the target unreachable by construction.
 */
const TOKEN_DEFINITION_FILES = new Set(['sa-theme.css']);

/** Hairlines and zero — a scale for these would be ceremony, not clarity. */
const ALLOWED_PX = new Set(['0px', '1px', '2px']);

const CATEGORIES = {
    // #rgb, #rrggbb, #rrggbbaa
    hexColor: /#[0-9a-fA-F]{3,8}\b/g,
    // rgb()/rgba()/hsl()/hsla() with literal channels
    functionalColor: /\b(?:rgba?|hsla?)\([^)]*\)/g,
    pixelValue: /\b\d{1,4}(?:\.\d+)?px\b/g,
    fontSize: /font-size:\s*([^;}\n]+)/g,
    breakpoint: /@media[^{]*?\(\s*(?:min|max)-width:\s*(\d+)px/g,
    // `var(--x, var(--x))` — a fallback to itself, i.e. no fallback at all
    selfReferencingVar: /var\((--[\w-]+),\s*var\(\1\)\)/g,
};

function walk(dir, predicate) {
    const found = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) found.push(...walk(full, predicate));
        else if (predicate(entry)) found.push(full);
    }
    return found;
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
    const files = walk(UI_SRC, (name) => name.endsWith('.vue') || name.endsWith('.css'));
    const findings = Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, []]));
    const styleShare = [];
    // How much was actually looked at, counted independently of what was found.
    // Every finding count can legitimately fall to zero once the migration is
    // done, so "no findings" cannot tell a finished job from a broken sweep.
    const reach = { files: 0, styleBlocks: 0 };

    for (const file of files) {
        const rel = relative(REPO_ROOT, file);
        // `basename`, not a split on '/': join() yields backslashes on Windows,
        // where the split would leave `name` as the whole path. `sa-theme.css`
        // would then miss the exclusion list and the palette's own literals
        // would be counted as violations — dozens of them, failing the budget.
        const name = basename(file);
        const content = readFileSync(file, 'utf8');
        const isTokenDefinition = TOKEN_DEFINITION_FILES.has(name);
        reach.files += 1;
        reach.styleBlocks += styleSource(file, content).length;

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
        distinctPixelValues: distinct(findings.pixelValue),
        distinctFontSizes: distinct(findings.fontSize),
        distinctBreakpoints: distinct(findings.breakpoint),
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
    console.log(`  distinct pixel values      ${summary.distinctPixelValues}`);
    console.log(`  distinct font sizes        ${summary.distinctFontSizes}`);
    console.log(`  distinct breakpoints       ${summary.distinctBreakpoints}`);
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
