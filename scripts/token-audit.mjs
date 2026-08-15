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

import { parse } from 'vue/compiler-sfc';

import { declarations, styleBlocks, withCommentsBlanked } from './codemods/lib/stylesheets.mjs';
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

/**
 * The script-side half of the palette definition.
 *
 * `tokens.primitive.css` holds the ramp for CSS; this file holds the same ramp
 * as concrete values, for the places where a colour is DATA rather than paint —
 * a promotion's accent is picked by an operator, sent over the wire and stored
 * in a column the DTO caps at 16 characters, so it cannot be a `var()`.
 *
 * Exempt for the same reason the directory above is: literals are what it is
 * for, and counting them would make the target unreachable by construction.
 *
 * A single named file rather than a directory, and that is the safer direction
 * here — the worry that made the theme exemption a directory was that a name
 * list would silently absorb the next file added. One name absorbs nothing: a
 * second palette file is counted. And `identity-accents-match-theme.test.js`
 * asserts that EVERY hex in this file is one of the ramp values, so it cannot
 * become somewhere to put a colour that has no role.
 */
const SCRIPT_PALETTE_FILE = join(UI_SRC, 'client', 'identity-accents.ts');

/**
 * Zero needs no token anywhere: `padding: 0` is idiomatic, and
 * `var(--sa-space-0)` for it would be ceremony.
 */
const ALWAYS_ALLOWED_PX = new Set(['0px']);

/**
 * Hairlines — but only where a hairline is what they are.
 *
 * A `border: 1px` is not a scale decision and never will be; a scale for it
 * would be the ceremony this exemption exists to avoid. `padding: 2px` is a
 * different animal: the spacing scale has a 2px rung, so a token exists and a
 * literal is debt.
 *
 * Applying the exemption to every property hid 114 spacing declarations from a
 * budget that claims to hold scale properties to zero literals — 72 of them
 * `padding`/`margin`/`gap: 2px`, i.e. the one value with a rung waiting for it.
 * The claim was false for exactly the values it sounded most confident about.
 */
const HAIRLINE_PX = new Set(['1px', '2px']);

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

/**
 * The CSS colour keywords worth naming, in one place.
 *
 * Two patterns need this list and they read it differently — one wants it after
 * a `property:`, the other wants it as an entire attribute value — so it lives
 * here rather than being spelled out twice. A second copy is how `fill: white`
 * ends up being debt and `fill="white"` does not.
 */
const NAMED_COLOUR_WORDS =
    'white|black|red|green|blue|orange|yellow|purple|grey|gray|silver|maroon|navy|teal|olive|lime|aqua|fuchsia';

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
    namedColor: new RegExp(
        `(?:^|[;{])\\s*(?:color|background(?:-color)?|border(?:-[a-z]+)?-color|outline-color|fill|stroke)` +
            `\\s*:\\s*([^;}\\n]*(?<![\\w-])(?:${NAMED_COLOUR_WORDS})(?![\\w-])[^;}\\n]*)`,
        'gi',
    ),
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
    templateColor: /(?!)/g,
};

/**
 * The three patterns above that answer "is this a colour", in one list.
 *
 * The template pass has to ask the same question the style loop asks, of a
 * different source. Asking it with a fourth copy of the patterns is how the two
 * halves end up disagreeing about what a colour is — which is the failure this
 * whole file exists to make visible.
 */
const COLOUR_PATTERNS = [CATEGORIES.hexColor, CATEGORIES.functionalColor, CATEGORIES.namedColor];

/**
 * Attributes that paint.
 *
 * The NAME decides, exactly as the property decides inside a stylesheet. That
 * is what keeps the pass quiet about everything else a `#` means in a template:
 * `#actions` is a slot, `mask="####-##-##"` is an input mask, `(#124)` in a
 * comment is a pull request, and `href="#top"` is an anchor. None of them is
 * read here, because none of them is a paint attribute — and none of them can
 * become a false finding when the next one is written as `(#a1b2c3)`.
 *
 * `color` is the one that depends on the ELEMENT rather than on the name, and
 * excluding it outright was wrong in one direction: on a Quasar component it
 * names a palette entry (`color="primary"`), but on a native SVG element it is
 * real paint — `<svg color="#fff">` is what `fill="currentColor"` resolves
 * against, so omitting it everywhere hid a literal that paints every glyph
 * below it. The tag decides, which is the same rule one level up.
 */
const PAINT_ATTRIBUTES = new Set([
    'style',
    'fill',
    'stroke',
    'stop-color',
    'flood-color',
    'lighting-color',
]);

/**
 * SVG elements, where `color` is paint rather than a component's palette prop.
 *
 * A list rather than "is it inside an `<svg>`": the ancestor test needs a stack
 * and gets the answer wrong for a component that renders an icon, while these
 * tag names mean an SVG element wherever they appear — Vue resolves a component
 * by a PascalCase or hyphenated name, so none of them can be shadowed.
 */
const SVG_ELEMENTS = new Set([
    'svg',
    'g',
    'path',
    'circle',
    'ellipse',
    'rect',
    'line',
    'polyline',
    'polygon',
    'text',
    'tspan',
    'use',
    'symbol',
    'defs',
    'marker',
    'mask',
    'pattern',
    'linearGradient',
    'radialGradient',
    'stop',
    'clipPath',
    'foreignObject',
]);

/**
 * `url(…)` contents, blanked before anything looks for a colour.
 *
 * A `#` inside `url()` is a FRAGMENT — `fill="url(#grad)"` points at a paint
 * server in the same document, and a paint server whose id happens to spell
 * three to eight hex digits (`#abc`, `#facade`) is not a colour anybody wrote.
 * Blanked to equal-length spaces rather than removed, because every line number
 * this file reports is an offset into the original value.
 *
 * The first version of this check had a test for it that proved nothing: the id
 * was `#g`, one character, which `hexColor` could never have matched. A test
 * whose fixture cannot reach the failure is a green tick over an open hole.
 */
const URL_FRAGMENT = /url\([^)]*\)/g;

/**
 * A paint attribute other than `style` carries the colour BARE — `fill="white"`
 * is a value with no property in front of it, so `CATEGORIES.namedColor` cannot
 * see it: that pattern is anchored on `property:` for good reason (`.text-white`
 * in a selector and a font called "Black" are not findings), and there is no
 * anchor here to give it.
 *
 * Without these two, the category treated `fill` and `stroke` as paint, found
 * their hexes, and silently let a named colour through under a zero floor —
 * a guard that covers three of the four notations is the kind of gap this whole
 * category exists to close.
 *
 * Two patterns because the two attribute kinds hold different languages: a
 * static attribute IS the colour, a bound one is JavaScript that may contain it
 * as a string.
 */
const BARE_NAMED_COLOUR = new RegExp(`^\\s*(?:${NAMED_COLOUR_WORDS})\\s*$`, 'i');
const QUOTED_NAMED_COLOUR = new RegExp(`(['"\`])\\s*(?:${NAMED_COLOUR_WORDS})\\s*\\1`, 'gi');

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
    return [...content.matchAll(/<script[^>]*>([\s\S]*?)<\/script[^>]*>/gi)]
        .map((m) => m[1])
        .join('\n');
}

/**
 * Colour literals in a TEMPLATE — the third place a colour can be written, and
 * the only one nothing read.
 *
 * The headline of this report was `hard-coded hex colours 0 in 0 files` while
 * twelve of them sat in six templates: three browser-chrome dots written out
 * twice, three diff markers reaching past the token layers for a primitive, and
 * three `p.color ?? '#94a3b8'` fallbacks that answered one question with two
 * different greys. A zero that is wrong is worse than a number that is large,
 * because it ends the search.
 *
 * Parsed, not matched — and the reasons are specific rather than stylistic:
 *
 *   - A `<template v-if>` nests inside the template, so no `<template>…
 *     </template>` pattern can find the block's extent without a depth counter.
 *   - A comment is its own node type, so `(#124)` in a `<!-- -->` is skipped
 *     without any stripping pass. Written as a regex over the template's text
 *     it would be a phantom colour the moment a pull-request number reaches six
 *     hex-shaped digits.
 *   - Reading PROPS rather than text is what keeps this honest for the next
 *     category too: over the same tree, template text holds ~90 `px` values of
 *     which only 20 are CSS — the rest are `size="18px"` component props.
 *
 * Vue ships the parser for the files these are; `theme-reaches-every-page`
 * reached the same conclusion after three rounds of fixing a hand-written one.
 *
 * @returns {null | {value: string, line: number}[]} null if the file is not an
 *          SFC or did not parse — the caller counts that, so a template the
 *          audit stopped reading cannot look like a template with no findings.
 */
function templatePaint(file, content) {
    if (!file.endsWith('.vue')) return null;
    const { descriptor, errors } = parse(content, { ignoreEmpty: false });
    if (errors.length > 0 || !descriptor.template?.ast) return null;

    const painted = [];
    const visit = (node) => {
        // ELEMENT === 1. Only an element carries props.
        if (node.type === 1) {
            // `color` paints on a native SVG element and names a Quasar palette
            // entry everywhere else, so the tag has to be part of the question.
            const paints = (name) =>
                PAINT_ATTRIBUTES.has(name) || (name === 'color' && SVG_ELEMENTS.has(node.tag));
            for (const prop of node.props ?? []) {
                // ATTRIBUTE === 6 — `style="background: #ef4444"`.
                if (prop.type === 6 && paints(prop.name) && prop.value) {
                    painted.push({
                        value: prop.value.content,
                        line: prop.value.loc.start.line,
                        attribute: prop.name,
                        isStatic: true,
                    });
                }
                // DIRECTIVE === 7 — `:style` is v-bind with `style` as its arg.
                // The expression is JavaScript, so what is read here is the
                // literal inside it: `p.color ?? '#94a3b8'` names a colour, and
                // `{ background: p.color }` names none.
                //
                // `isStatic` because a DYNAMIC argument carries the variable's
                // name, not the attribute's: in `:[style]="x"` the arg reads
                // `style` and the attribute is whatever that variable holds.
                if (
                    prop.type === 7 &&
                    prop.name === 'bind' &&
                    prop.arg?.isStatic &&
                    paints(prop.arg.content) &&
                    prop.exp
                ) {
                    painted.push({
                        value: prop.exp.content,
                        line: prop.exp.loc.start.line,
                        attribute: prop.arg.content,
                        isStatic: false,
                    });
                }
            }
        }
        for (const child of node.children ?? []) visit(child);
    };
    for (const child of descriptor.template.ast.children ?? []) visit(child);
    return painted;
}

/**
 * The colour literals among those painted values, with the line each sits on.
 *
 * Exported for its own test. `null` and `[]` mean different things and the
 * caller depends on the difference: `null` is "this file has no template the
 * audit could read", `[]` is "read it, found nothing". Collapsing the two is
 * how a template the parser stopped understanding would report as clean.
 */
export function templateColourSites(file, content) {
    const painted = templatePaint(file, content);
    if (painted === null) return null;

    const sites = [];
    // Relative to where the value starts, so a binding spread over several
    // lines points at the literal rather than at the opening quote.
    const at = (line, value, index) => line + lineOf(value, index) - 1;

    for (const { value, line, attribute, isStatic } of painted) {
        // A `url()` is an address, not a colour, and its fragment can spell one:
        // `fill="url(#facade)"` points at a paint server. Blanked rather than
        // removed so `at()` still lands on the right line.
        const paint = value.replace(URL_FRAGMENT, (m) => ' '.repeat(m.length));

        for (const pattern of COLOUR_PATTERNS) {
            for (const match of paint.matchAll(pattern)) {
                sites.push({
                    line: at(line, paint, match.index),
                    value: (match[1] ?? match[0]).trim(),
                });
            }
        }

        // `style` holds declarations, which the patterns above already read.
        // Every other paint attribute holds the colour on its own.
        if (attribute === 'style') continue;
        if (isStatic) {
            if (BARE_NAMED_COLOUR.test(paint)) sites.push({ line, value: paint.trim() });
            continue;
        }
        for (const match of paint.matchAll(QUOTED_NAMED_COLOUR)) {
            sites.push({ line: at(line, paint, match.index), value: match[0] });
        }
    }
    return sites.sort((a, b) => a.line - b.line);
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
    // `vueFiles` and `templates` are counted separately on purpose: they must be
    // EQUAL. A file the SFC parser stopped reading contributes no props and so
    // no findings, which is indistinguishable from a clean template — the same
    // failure the other two counters exist to catch, one level down.
    const reach = { files: 0, styleBlocks: 0, vueFiles: 0, templates: 0 };

    for (const file of files) {
        const rel = relative(REPO_ROOT, file);
        const content = readFileSync(file, 'utf8');
        const isTokenDefinition = file.startsWith(TOKEN_DEFINITION_DIR);
        reach.files += 1;
        reach.styleBlocks += styleBlocks(file, content).length;

        if (!isTokenDefinition) {
            const script = scriptSource(file, content)
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/^\s*\/\/.*$/gm, '');
            if (file !== SCRIPT_PALETTE_FILE) {
                for (const match of script.matchAll(CATEGORIES.hexColor)) {
                    findings.scriptColor.push({ file: rel, line: 0, value: match[0] });
                }
                for (const match of script.matchAll(CATEGORIES.functionalColor)) {
                    findings.scriptColor.push({ file: rel, line: 0, value: match[0] });
                }
            }
            // Over the WHOLE file, not only the script block: the same trick is
            // written straight into a `:style` binding in the template, and
            // that is where one of the two live instances sat.
            // Comments stripped for the same reason the script sweep strips
            // them: the sentence explaining this rule contains an example of
            // what it forbids, and prose is not paint.
            //
            // All THREE kinds a `.vue` file can hold. This sweep reads the
            // whole file rather than only the script block, so `// use
            // color-mix, not accent + '15'` in a script and the same sentence
            // in a `<!-- -->` above a template are both reachable — and either
            // would fail a zero budget over a line telling people not to do the
            // thing. Only block comments were handled, which made the rule's
            // own documentation the first thing it flagged.
            //
            // `//` needs whitespace or a line start in front of it, or the `//`
            // in `https://…` would blank the rest of that line.
            //
            // Blanked rather than deleted, newlines kept, so `line` still
            // points at the real line.
            const blank = (m) => m.replace(/[^\n]/g, ' ');
            const prose = content
                .replace(/\/\*[\s\S]*?\*\//g, blank)
                .replace(/<!--[\s\S]*?(?:--!?>)/g, blank)
                .replace(/(^|\s)\/\/[^\n]*/gm, (m, lead) => lead + blank(m.slice(lead.length)));
            for (const match of prose.matchAll(ALPHA_CONCAT)) {
                findings.alphaConcat.push({
                    file: rel,
                    line: lineOf(content, match.index),
                    value: match[0],
                });
            }
        }

        if (file.endsWith('.vue')) {
            reach.vueFiles += 1;
            const total = content.split('\n').length;
            const styleLines = styleBlocks(file, content).reduce(
                (sum, block) => sum + block.text.split('\n').length,
                0,
            );
            styleShare.push({ file: rel, total, styleLines, share: styleLines / total });

            const sites = templateColourSites(file, content);
            if (sites !== null) {
                reach.templates += 1;
                if (!isTokenDefinition) {
                    for (const site of sites) findings.templateColor.push({ file: rel, ...site });
                }
            }
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
                    if (ALWAYS_ALLOWED_PX.has(match[0])) continue;
                    if (!scaled && HAIRLINE_PX.has(match[0])) continue;
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

        for (const block of styleBlocks(file, content)) {
            // Comments blanked, and the same way the declaration pass above
            // blanks them, so the two halves of this file agree about what is
            // paint. Reading the raw text made a rule's own documentation the
            // first thing it flagged — `#f59e0b` inside a comment explaining
            // why `#f59e0b` may not be written was a hard-coded colour.
            // Blanked rather than stripped: `lineOf` is an offset into the
            // original text.
            const text = withCommentsBlanked(block.text);
            for (const [category, pattern] of Object.entries(CATEGORIES)) {
                if (category === 'selfReferencingVar') continue;
                for (const match of text.matchAll(pattern)) {
                    const value = (match[1] ?? match[0]).trim();
                    if (category === 'pixelValue' && ALWAYS_ALLOWED_PX.has(value)) continue;
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
        templateColors: {
            total: findings.templateColor.length,
            files: files(findings.templateColor),
        },
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
    // "in stylesheets", not "hard-coded", because the next three lines are also
    // hard-coded colours and this one used to read 0 while they did not.
    console.log(
        `  colours in stylesheets     ${summary.hexColors.total} in ${summary.hexColors.files} files`,
    );
    console.log(`  rgb()/hsl() literals       ${summary.functionalColors.total}`);
    console.log(`  named colours              ${summary.namedColors.total}`);
    console.log(
        `  colours in script          ${summary.scriptColors.total} in ${summary.scriptColors.files} files`,
    );
    console.log(
        `  colours in templates       ${summary.templateColors.total} in ${summary.templateColors.files} files`,
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
