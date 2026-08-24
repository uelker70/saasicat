#!/usr/bin/env node
// Moves the admin UI's spacing and radii onto the scale.
//
// The colour migration in phase 1 left this half undone, and the numbers say
// why it had to be one connected change rather than a file at a time: 614 of
// the 1,207 pixel values on scale properties already sat exactly on a token,
// and 593 did not — mostly on the MIDPOINTS between rungs. `6px` appeared 137
// times, `10px` 99, `14px` 65, `18px` 34. The declared ladder is 2/4/8/12/16/
// 20/24; what the code actually used was a 2px ladder underneath it.
//
// So every one of those is a decision, and taking them one file at a time means
// the same value lands differently in two places. Here they all move at once,
// by one rule.
//
// **Ties round down.** `6px` is two from `4px` and two from `8px`. Rounding the
// midpoints up would add 2px to about 350 declarations — every dense row, every
// chip, every button — and the failure that produces is horizontal overflow at
// the narrow breakpoints, which the visual suite catches late and a reader
// catches on a phone. Rounding down cannot overflow anything. The surface gets
// marginally tighter, and the alternative was a thirteenth rung, which is a
// scale that has stopped deciding.
//
//   node scripts/codemods/px-to-scale.mjs             report what would change
//   node scripts/codemods/px-to-scale.mjs --write     change it

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Both packages that write component CSS.
 *
 * `@saasicat/ui-vue-tenant` was easy to forget and would have kept 112 raw
 * values while its sibling had none — the tenant components read the same
 * roles, they just render in somebody else's application.
 */
const TREES = [join(ROOT, 'packages/ui-vue/src'), join(ROOT, 'packages/ui-vue-tenant/src')];

/** The token layer declares the literals; that is its job. */
const EXCLUDED = join(ROOT, 'packages/ui-vue/src', 'ui', 'theme');

/** Properties a scale answers for — the same set `scripts/token-audit.mjs` counts. */
const SCALE_PROPERTY =
    /^(?:padding|margin|gap|row-gap|column-gap|inset|top|right|bottom|left|border(?:-[a-z]+)?-radius|letter-spacing|word-spacing|text-indent)(?:-[a-z-]+)?$/;

/** The spacing ladder, in the order `tokens.scale.css` declares it. */
const SPACE = [
    [0, '--sa-space-0'],
    [2, '--sa-space-1'],
    [4, '--sa-space-2'],
    [8, '--sa-space-3'],
    [12, '--sa-space-4'],
    [16, '--sa-space-5'],
    [20, '--sa-space-6'],
    [24, '--sa-space-7'],
    [32, '--sa-space-8'],
    [40, '--sa-space-9'],
    [48, '--sa-space-10'],
    [64, '--sa-space-11'],
];

/**
 * The radii, which are named by what they wrap rather than numbered.
 *
 * `--sa-radius-tile` and `--sa-radius-head` are both 10px; the tile is the one
 * a reader means far more often, so it wins the lookup and `head` stays
 * available by name for the two places that mean the section head.
 */
const RADIUS = [
    [5, '--sa-radius-badge'],
    [7, '--sa-radius-control'],
    [8, '--sa-radius-field'],
    [10, '--sa-radius-tile'],
    [12, '--sa-radius-card'],
    [14, '--sa-radius-section'],
    [16, '--sa-radius-hero'],
    [999, '--sa-radius-pill'],
];

/**
 * Tracking, declared in `em` because it scales with the text it tracks.
 *
 * The surface used ten distinct values against these four steps, and the top of
 * it — `0.08em` through `0.16em`, 31 declarations on uppercase micro-labels —
 * collapses onto `wider`. That is the same trade the spacing ladder makes: a
 * scale that grows a rung for every value in use has stopped deciding anything.
 * The labels lose up to 0.1em of tracking, which is narrower text and no
 * overflow risk.
 */
const TRACKING = [
    [-0.02, '--sa-tracking-tight'],
    [0, '--sa-tracking-normal'],
    [0.04, '--sa-tracking-wide'],
    [0.06, '--sa-tracking-wider'],
];

/**
 * What a pixel tracking value is worth in `em`.
 *
 * The admin surface sets tracking on its small labels, which run 11–13px, so a
 * pixel there divides by roughly twelve: `0.5px` is about `0.04em`. Converting
 * rather than snapping is the point — a tracking that does not scale with its
 * text is a tracking that breaks when somebody zooms.
 */
const TRACKING_REFERENCE_PX = 12;

/**
 * The rung nearest a value, with the tie rule the header explains.
 *
 * `tiesUp` exists because the two scales fail differently. Rounding a length
 * down cannot overflow anything, so lengths round down. Rounding a tracking
 * down can reach `normal`, which does not make the tracking smaller — it
 * deletes it, and the label it was applied to changes character rather than
 * width. So tracking rounds up and stays tracked.
 *
 * Distances are compared at four decimals: `0.05em` is equidistant from
 * `0.04em` and `0.06em`, and in binary floating point it is not, which would
 * decide a tie by an artefact rather than by the rule.
 */
export function nearestToken(value, rungs, { signed = false, tiesUp = false } = {}) {
    const target = signed ? value : Math.abs(value);
    const distance = (rung) => Math.round(Math.abs(rung[0] - target) * 10000) / 10000;
    let best = rungs[0];
    for (const rung of rungs) {
        const gap = distance(rung) - distance(best);
        if (gap < 0 || (gap === 0 && tiesUp && rung[0] > best[0])) best = rung;
    }
    return best;
}

/** Whether a property's value is tracking rather than a length. */
const isTracking = (property) =>
    property.includes('letter-spacing') || property.includes('word-spacing');

/** The replacement for one `<n>em` on a tracking property. */
export function trackingToken(em) {
    const [, token] = nearestToken(em, TRACKING, { signed: true, tiesUp: true });
    return `var(${token})`;
}

/** The replacement for one `<n>px` in a declaration of `property`. */
export function tokenFor(property, pixels) {
    if (isTracking(property)) return trackingToken(pixels / TRACKING_REFERENCE_PX);
    const rungs = property.includes('radius') ? RADIUS : SPACE;
    const [value, token] = nearestToken(pixels, rungs);
    if (pixels < 0) {
        // A custom property cannot carry the sign for a negative margin without
        // a second token per rung, so the negation stays where it is written.
        return value === 0 ? '0' : `calc(-1 * var(${token}))`;
    }
    return `var(${token})`;
}

/**
 * Replaces every `<number><unit>` in a value, by scanning rather than matching.
 *
 * A pattern for "an optional sign, digits, an optional dot, digits" has two
 * quantifiers over the same characters and backtracks polynomially — the rule
 * this repository put in its linter after three CodeQL findings in two days.
 * The scan is one pass and cannot.
 */
export function replaceUnit(value, unit, convert) {
    let out = '';
    let index = 0;
    let changed = false;

    while (index < value.length) {
        const start = numberStart(value, index);
        if (start === -1) return { text: out + value.slice(index), changed };

        out += value.slice(index, start);
        const end = numberEnd(value, start);
        const digits = value.slice(start, end);
        const after = end + unit.length;

        if (value.startsWith(unit, end) && !isWordCharacter(value[after])) {
            out += convert(Number(digits));
            changed = true;
            index = after;
        } else {
            out += digits;
            index = end;
        }
    }
    return { text: out, changed };
}

/** Where the next number begins, or -1. `-` and `.` count only before a digit. */
function numberStart(value, from) {
    for (let index = from; index < value.length; index += 1) {
        const character = value[index];
        if (isDigit(character)) return index;
        if ((character === '-' || character === '.') && isDigit(value[index + 1])) return index;
    }
    return -1;
}

/** Where that number ends: one optional sign, digits, one optional dot, digits. */
function numberEnd(value, start) {
    let index = start;
    if (value[index] === '-') index += 1;
    while (isDigit(value[index])) index += 1;
    if (value[index] === '.') {
        index += 1;
        while (isDigit(value[index])) index += 1;
    }
    return index;
}

const isDigit = (character) => character >= '0' && character <= '9';
const isWordCharacter = (character) => character !== undefined && /^[a-z0-9-]$/i.test(character);

/** Rewrites the pixel values in one declaration. Returns null when nothing changes. */
export function rewriteDeclaration(property, value) {
    if (!SCALE_PROPERTY.test(property)) return null;
    // A declaration of a token itself is the token layer's business, and a
    // `calc()` this codemod already wrote must not be rewritten again.
    if (property.startsWith('--')) return null;

    const pixels = replaceUnit(value, 'px', (n) => tokenFor(property, n));
    let { text, changed } = pixels;
    if (isTracking(property)) {
        const em = replaceUnit(text, 'em', (n) => trackingToken(n));
        text = em.text;
        changed = changed || em.changed;
    }
    return changed ? text : null;
}

function sourceFiles(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (path.startsWith(EXCLUDED)) continue;
        if (statSync(path).isDirectory()) sourceFiles(path, out);
        else if (path.endsWith('.vue') || path.endsWith('.css')) out.push(path);
    }
    return out;
}

const PROPERTY_NAME = /^[a-z-]+$/;

/**
 * Splits one line into `property: value;`, by index.
 *
 * A pattern would put `\s*` next to `[^;]+`, which overlap on whitespace and
 * backtrack. Two `indexOf` calls decide it and cannot.
 */
export function splitDeclaration(line) {
    const colon = line.indexOf(':');
    if (colon === -1) return null;
    const semicolon = line.indexOf(';', colon);
    if (semicolon === -1) return null;

    const property = line.slice(0, colon).trim();
    if (!PROPERTY_NAME.test(property)) return null;

    return {
        head: line.slice(0, colon + 1),
        space: line.slice(colon + 1, colon + 1 + leadingSpace(line, colon + 1)),
        property,
        value: line.slice(colon + 1, semicolon).trim(),
        tail: line.slice(semicolon),
    };
}

function leadingSpace(line, from) {
    let count = 0;
    while (line[from + count] === ' ' || line[from + count] === '\t') count += 1;
    return count;
}

export function rewriteFile(text) {
    let touched = 0;
    const lines = text.split('\n').map((line) => {
        const parts = splitDeclaration(line);
        if (!parts) return line;
        const next = rewriteDeclaration(parts.property, parts.value);
        if (next === null) return line;
        touched += 1;
        return `${parts.head}${parts.space}${next}${parts.tail}`;
    });
    return { text: lines.join('\n'), touched };
}

/** Runs the codemod over the tree. Exported so a test can drive it without the CLI. */
export function run({ write = false } = {}) {
    let files = 0;
    let declarations = 0;
    const changed = [];

    for (const file of TREES.flatMap((tree) => sourceFiles(tree))) {
        const before = readFileSync(file, 'utf8');
        const { text, touched } = rewriteFile(before);
        if (!touched) continue;
        files += 1;
        declarations += touched;
        changed.push({ file: relative(ROOT, file), touched });
        if (write) writeFileSync(file, text);
    }
    return { files, declarations, changed };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const write = process.argv.includes('--write');
    const { files, declarations, changed } = run({ write });
    for (const { file, touched } of changed) process.stdout.write(`${file}: ${touched}\n`);
    process.stdout.write(
        `${write ? 'rewrote' : 'would rewrite'} ${declarations} declarations in ${files} files\n`,
    );
}
