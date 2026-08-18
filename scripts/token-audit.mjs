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
 * The CSS-wide keywords — a value that invents none.
 *
 * `font-weight: inherit` takes the weight the parent already decided,
 * `line-height: unset` falls back to inheritance or to the initial value, and
 * `letter-spacing: revert` hands the declaration back to the user-agent sheet.
 * None of them names a value a token could have named, so counting them would
 * put a component that deliberately inherits into the typography budget — and
 * the budget's own advice, "read a token instead", does not apply to a
 * declaration whose whole point is to read whatever is above it.
 *
 * The file was already inconsistent about this, one property over:
 * `fontShorthandLiteral()` calls `font: inherit` clean, because it asks whether
 * a NUMBER is left. The longhand patterns ask for a value and a keyword is one.
 *
 * A written-out list, which this file otherwise refuses (see
 * `NON_PAINT_PROPERTIES`, which had to be inverted for exactly that reason).
 * The difference is that the CSS-wide keywords are a closed set in the
 * specification — five of them, defined once for every property there is — so
 * this list cannot go stale against the codebase the way a list of properties,
 * palette names or component props does.
 */
const CSS_WIDE_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);

/**
 * Whether a declaration value is nothing but such a keyword.
 *
 * The importance flag is stripped first because it belongs to the DECLARATION
 * rather than to the value: `line-height: inherit !important` inherits exactly
 * as the plain form does. The package writes `!important` where it has to
 * out-specify one of Quasar's own rules, so the combination is reachable here.
 *
 * ASCII case-insensitive, like every other keyword in CSS.
 */
const isCssWideKeyword = (value) =>
    CSS_WIDE_KEYWORDS.has(
        value
            .replace(/\s*!\s*important\s*$/i, '')
            .trim()
            .toLowerCase(),
    );

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
 * Every CSS named colour, not a shortlist of the obvious ones.
 *
 * The shortlist was eighteen words, and eighteen words is a floor of zero with
 * a hole in it: `fill="gold"` and `color: pink` are literals the budget claimed
 * to forbid and never saw. There is no reason to prefer a subset — the set is
 * closed, standardised, and 148 long, so it is written out.
 *
 * `transparent` and `currentcolor` are deliberately NOT here. Neither invents a
 * colour: one paints nothing and the other defers to whatever `color` resolved
 * to, which is the behaviour the token layers rely on.
 *
 * Two patterns read this and read it differently — one wants it after a
 * `property:`, the other wants it as an entire attribute value — so it lives
 * here rather than being spelled out twice. A second copy is how `fill: white`
 * ends up being debt and `fill="white"` does not.
 *
 * The alternation is safe unordered: both patterns bound the match with
 * `(?![\w-])` or with `^…$`, so `blue` cannot match inside `blueviolet`.
 */
const NAMED_COLOUR_WORDS = [
    'aliceblue',
    'antiquewhite',
    'aqua',
    'aquamarine',
    'azure',
    'beige',
    'bisque',
    'black',
    'blanchedalmond',
    'blue',
    'blueviolet',
    'brown',
    'burlywood',
    'cadetblue',
    'chartreuse',
    'chocolate',
    'coral',
    'cornflowerblue',
    'cornsilk',
    'crimson',
    'cyan',
    'darkblue',
    'darkcyan',
    'darkgoldenrod',
    'darkgray',
    'darkgreen',
    'darkgrey',
    'darkkhaki',
    'darkmagenta',
    'darkolivegreen',
    'darkorange',
    'darkorchid',
    'darkred',
    'darksalmon',
    'darkseagreen',
    'darkslateblue',
    'darkslategray',
    'darkslategrey',
    'darkturquoise',
    'darkviolet',
    'deeppink',
    'deepskyblue',
    'dimgray',
    'dimgrey',
    'dodgerblue',
    'firebrick',
    'floralwhite',
    'forestgreen',
    'fuchsia',
    'gainsboro',
    'ghostwhite',
    'gold',
    'goldenrod',
    'gray',
    'green',
    'greenyellow',
    'grey',
    'honeydew',
    'hotpink',
    'indianred',
    'indigo',
    'ivory',
    'khaki',
    'lavender',
    'lavenderblush',
    'lawngreen',
    'lemonchiffon',
    'lightblue',
    'lightcoral',
    'lightcyan',
    'lightgoldenrodyellow',
    'lightgray',
    'lightgreen',
    'lightgrey',
    'lightpink',
    'lightsalmon',
    'lightseagreen',
    'lightskyblue',
    'lightslategray',
    'lightslategrey',
    'lightsteelblue',
    'lightyellow',
    'lime',
    'limegreen',
    'linen',
    'magenta',
    'maroon',
    'mediumaquamarine',
    'mediumblue',
    'mediumorchid',
    'mediumpurple',
    'mediumseagreen',
    'mediumslateblue',
    'mediumspringgreen',
    'mediumturquoise',
    'mediumvioletred',
    'midnightblue',
    'mintcream',
    'mistyrose',
    'moccasin',
    'navajowhite',
    'navy',
    'oldlace',
    'olive',
    'olivedrab',
    'orange',
    'orangered',
    'orchid',
    'palegoldenrod',
    'palegreen',
    'paleturquoise',
    'palevioletred',
    'papayawhip',
    'peachpuff',
    'peru',
    'pink',
    'plum',
    'powderblue',
    'purple',
    'rebeccapurple',
    'red',
    'rosybrown',
    'royalblue',
    'saddlebrown',
    'salmon',
    'sandybrown',
    'seagreen',
    'seashell',
    'sienna',
    'silver',
    'skyblue',
    'slateblue',
    'slategray',
    'slategrey',
    'snow',
    'springgreen',
    'steelblue',
    'tan',
    'teal',
    'thistle',
    'tomato',
    'turquoise',
    'violet',
    'wheat',
    'white',
    'whitesmoke',
    'yellow',
    'yellowgreen',
].join('|');

/**
 * Properties where a colour WORD is an identifier rather than a colour.
 *
 * The inverse of the list that used to be here, and the reason for the flip:
 * an allow-list of colour-bearing properties cannot be finished. It was
 * corrected four times — `border` and `box-shadow`, then `text-decoration`,
 * then `border-block` and `scrollbar-color` — and CSS keeps adding more, so
 * every round of review found another and every fix was one property wide.
 *
 * A colour keyword in a declaration VALUE is a colour, except where the
 * property's grammar accepts an AUTHOR-CHOSEN IDENTIFIER: `grid-area: red`
 * names a template area, `font-family: Linen` a typeface, `animation: gold` a
 * keyframe set, `list-style-type: red` a counter style the author defined.
 * That criterion is what the list is derived from, and it is the thing to
 * apply when CSS adds another — the list itself is not closed, and an earlier
 * version of this comment claimed it was.
 *
 * It stays short because `(?<![\w-])`/`(?![\w-])` carry most of the weight:
 * `red` inside `red-pulse` or `--sa-red-500` cannot match, so only a value
 * that is a BARE chosen name reaches here. Custom properties are deliberately
 * absent — `--brand: red` in a component is a literal, and catching it is the
 * point.
 */
const NON_PAINT_PROPERTIES = new Set([
    'anchor-name',
    'animation',
    'animation-name',
    'container',
    'container-name',
    'content',
    'counter-increment',
    'counter-reset',
    'counter-set',
    'font',
    'font-family',
    'font-palette',
    'grid-area',
    'grid-column',
    'grid-column-end',
    'grid-column-start',
    'grid-row',
    'grid-row-end',
    'grid-row-start',
    'grid-template-areas',
    'list-style',
    'list-style-type',
    'page',
    'position-anchor',
    'quotes',
    'scroll-timeline',
    'scroll-timeline-name',
    'timeline-scope',
    'transition',
    'transition-property',
    'view-timeline',
    'view-timeline-name',
    'view-transition-name',
    'will-change',
]);

const CATEGORIES = {
    // #rgb, #rrggbb, #rrggbbaa
    hexColor: /#[0-9a-fA-F]{3,8}\b/g,
    // rgb()/rgba()/hsl()/hsla() with LITERAL channels. `rgb(var(--x) / .06)` is
    // a token being used, not a value being invented, and counting it would
    // make an alpha derived from a theme-aware ink indistinguishable from a
    // hard-coded shadow — the first is the goal, the second is the debt.
    // Every CSS colour function, not only the two everybody remembers. `oklch()`
    // and `lab()` are literals exactly as `rgb()` is, and a floor of zero that
    // reads four notations out of ten is a floor with a hole in it. `color()`
    // is here too, which is why the `var(` guard matters more than it looks:
    // Chromium serialises `color-mix()` output as `color(srgb …)`.
    //
    // `i`, because CSS function names are ASCII case-insensitive and `RGB(1 2 3)`
    // is valid. Every pattern here that reads CSS SYNTAX carries the flag for
    // that reason; `selfReferencingVar` is the one that deliberately does not,
    // since a custom-property name IS case-sensitive.
    functionalColor: /\b(?:rgba?|hsla?|hwb|(?:ok)?lab|(?:ok)?lch|color)\((?![^)]*var\()[^)]*\)/gi,
    // A named colour is a literal too, and it hid from the two above for the
    // whole migration: `color: white` is neither a hex nor a function, so the
    // audit read 0 while one button still painted itself.
    //
    // Group 1 is the PROPERTY and group 2 the value, because the property is
    // filtered against `NON_PAINT_PROPERTIES` rather than matched against a
    // list of paint ones — see there for why the list had to be inverted.
    namedColor: new RegExp(
        `(?:^|[;{])\\s*([-\\w]+)\\s*:\\s*` +
            `([^;}\\n]*(?<![\\w-])(?:${NAMED_COLOUR_WORDS})(?![\\w-])[^;}\\n]*)`,
        'gi',
    ),
    pixelValue: /\b\d{1,4}(?:\.\d+)?px\b/gi,
    // Filled by the declaration pass; see SCALE_PROPERTY below.
    scalePixel: /(?!)/g,
    dimensionPixel: /(?!)/g,
    fontSize: /font-size:\s*([^;}\n]+)/gi,
    // The three scales AP2 §2.4 declares alongside the type sizes, and the
    // three nothing counted. Each has a token family and zero consumers of it,
    // which is the state a scale decays from: the tokens exist, nobody is told
    // they are missing, and the next author picks a number that looks right
    // next to the last one — exactly how the package reached 23 font sizes.
    //
    // Counted, not forbidden. `800` has no rung at all, so a floor of zero
    // would be a decision about the scale rather than about the code, and that
    // decision is not this script's to take.
    fontWeight: /font-weight:\s*([^;}\n]+)/gi,
    lineHeight: /line-height:\s*([^;}\n]+)/gi,
    letterSpacing: /letter-spacing:\s*([^;}\n]+)/gi,
    // Filled by the declaration pass; see fontShorthandLiteral below.
    fontShorthand: /(?!)/g,
    // Filled by the template pass; see QUASAR_COLOUR_CLASS and
    // `isQuasarPaletteAttribute`. Two categories rather than one, because the
    // two syntaxes migrate differently: a class comes off with a rule, a prop
    // with a component API.
    quasarColorClass: /(?!)/g,
    quasarColorProp: /(?!)/g,
    // Fractional too. Quasar's upper bounds are `599.98px` and friends — the
    // 0.02px step back that stops `max-width` and the next `min-width` both
    // matching at an integer viewport. An integer-only pattern read 0 the
    // moment the package adopted them, which is the most flattering possible
    // way for this number to be wrong.
    breakpoint: /@media[^{]*?\(\s*(?:min|max)-width:\s*(\d+(?:\.\d+)?)px/gi,
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
 * The names of those same three categories, derived from the list above rather
 * than written out again.
 *
 * The style pass reads two kinds of source — a `<style>` block and an inline
 * `style="…"` — and only the first owns its colours: inside a template
 * `templateColor` has already counted them, and it reaches places this pass
 * cannot (a bound `:style`, a bare `fill="white"`). Naming the three again here
 * is how the two halves start disagreeing about what a colour is, which is the
 * failure this whole file exists to make visible.
 */
const COLOUR_CATEGORIES = new Set(
    Object.entries(CATEGORIES)
        .filter(([, pattern]) => COLOUR_PATTERNS.includes(pattern))
        .map(([name]) => name),
);

/**
 * The one place that decides what a `namedColor` match means.
 *
 * That pattern captures a property and a value, and both consumers — the
 * stylesheet loop and the template pass — need the same two decisions from it:
 * skip the properties where a colour word is a name, and report the value
 * rather than the property. Written twice, the two halves drift, which is the
 * failure this whole file exists to make visible.
 *
 * @returns {null | string} the literal, or null when the property does not paint
 */
function namedColourValue(match) {
    const property = (match[1] ?? '').trim().toLowerCase();
    if (NON_PAINT_PROPERTIES.has(property)) return null;
    return (match[2] ?? '').trim();
}

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
 * Quasar's colour palette — the vocabulary, without saying where it is written.
 *
 * A palette name is a colour decision that carries no colour: `grey-7` contains
 * no hex, no function and no CSS named keyword, so none of the three patterns
 * above can see one. It resolves to Quasar's own scale, one layer below the
 * role tokens and outside the theme entirely — a `grey-7` caption stays the
 * same grey when the dark theme moves every surface under it, and the reader of
 * the template cannot tell that from the name.
 *
 * A template writes it in TWO syntaxes, and they are the same decision:
 * `class="text-grey-7"` uses Quasar's utility class, `color="grey-7"` uses the
 * palette prop its components take. The two constants below read one each, off
 * this one list — counting the class and walking past the prop is the failure
 * this file exists to make visible, one attribute over.
 *
 * The vocabulary is Quasar's, not this project's: nineteen Material hues with
 * fourteen shades each, plus thirteen brand, status and utility colours. A
 * subset would be a floor with a hole in it, exactly as a shortlist of named
 * CSS colours was.
 *
 * Written out here rather than read from `quasar/dist/quasar.css` at run time,
 * because a counting script that resolves a package from `node_modules` fails
 * for a reason that has nothing to do with what it counts. It is not a guess
 * either: `theme-layer-discipline.test.js` derives the same set from that
 * stylesheet — every name that Quasar defines as BOTH `.text-x` and `.bg-x`,
 * which is what separates a colour from `.text-bold` — and fails when the two
 * disagree. The list is an assertion, not a memory.
 *
 * Counted, not forbidden, and deliberately NOT paired with an ESLint rule
 * carrying a list of the files that may keep theirs: an exception list is the
 * same defect one level up. Count first; the rule is worth writing when the
 * number reaches zero and can stay there.
 */
export const QUASAR_PALETTE_NAMES = [
    'primary',
    'secondary',
    'accent',
    'dark',
    'positive',
    'negative',
    'info',
    'warning',
    'white',
    'black',
    'transparent',
    'separator',
    'dark-separator',
    'red',
    'pink',
    'purple',
    'deep-purple',
    'indigo',
    'blue',
    'light-blue',
    'cyan',
    'teal',
    'green',
    'light-green',
    'lime',
    'yellow',
    'amber',
    'orange',
    'deep-orange',
    'brown',
    'grey',
    'blue-grey',
];

/**
 * `text-<palette>` / `bg-<palette>`, with Quasar's optional shade suffix.
 *
 * The bounds matter as much as the vocabulary: `sa-text-sm` must not match on
 * `text-sm`, and `.text-grey-7` written as a SELECTOR in a stylesheet is a rule
 * about the class rather than a use of it. The first is handled by requiring a
 * word boundary that is not `-`, the second by only ever running this over a
 * template's `class` attributes.
 */
const QUASAR_COLOUR_CLASS = new RegExp(
    `(?<![\\w-])(?:text|bg)-(?:${QUASAR_PALETTE_NAMES.join('|')})(?:-\\d{1,2})?(?![\\w-])`,
    'g',
);

/**
 * The props that take a palette name.
 *
 * Quasar's own vocabulary: `color`, and the two a component uses when it paints
 * both halves (`text-color`/`bg-color` on a chip, a badge, a button). These
 * three are disjoint from `PAINT_ATTRIBUTES`, so nothing is counted under two
 * metrics.
 *
 * Unlike there, the name is only half the question: these are a COMPONENT's
 * API, so the tag decides whether they mean Quasar's palette at all. See
 * `isQuasarComponent`.
 */
/**
 * Whether a prop on a Quasar component takes a palette name.
 *
 * Derived from Quasar's own convention rather than listed: every such prop is
 * `color` or ends in `-color` — `text-color`, `bg-color`, and on the components
 * that have more of them, `active-color`, `done-color`, `error-color`,
 * `inactive-color`, `indicator-color`, `track-color`, `thumb-color`,
 * `label-color`, `selected-color`. A list of three understated the package's own
 * debt: `PlanChangeWizard.vue:19` writes `active-color="primary"` and went
 * uncounted, so the ratchet had room it was never granted.
 *
 * Widening costs nothing in the other direction. A prop that ends in `-color`
 * and does not take a palette name still has to carry a palette VALUE to be
 * counted, and `QUASAR_PALETTE_VALUE` decides that separately.
 */
const isQuasarPaletteAttribute = (name) => name === 'color' || name.endsWith('-color');

/**
 * Whether a tag is one of Quasar's components.
 *
 * `color`, `text-color` and `bg-color` name a palette entry on a Quasar
 * component and nothing in particular anywhere else, so reading them off every
 * element made the metric answer for props it has no claim to:
 * `<my-chart color="primary">` declares its own prop, `<div color="primary">`
 * is an unknown attribute, and neither introduces a dependency on Quasar's
 * palette — but both raised the count and could fail the ratchet.
 *
 * Derived from the prefix the library gives every component it registers,
 * rather than from a list of the ones this package happens to write today. A
 * list would go stale in the direction that costs most: the next Quasar
 * component to reach a template would be one the audit had never heard of, and
 * the number would stay flat while a palette decision was written.
 *
 * A template may spell the tag either way and Vue resolves both to the same
 * component, so it is hyphenated first — `QBtn` and `q-btn` are one decision.
 * The prefix is `q-` and not `q`, so `qux-panel` is somebody else's component.
 *
 * The boundary this leaves is `<component :is="…">`: the tag is `component` and
 * the real one is in a script, where no template pass can reach it. That is the
 * same trade `templatePaletteProps` already takes for `:color="statusColor(row)"`
 * — a name nothing in the template spells is missed rather than guessed.
 *
 * Exported so `theme-layer-discipline.test.js` can hold the convention to the
 * Quasar release this package builds against, the way it already does for the
 * palette names. A convention is a claim about somebody else's library, and a
 * claim is worth exactly as much as the assertion under it.
 */
const hyphenate = (tag) => tag.replace(/\B([A-Z])/g, '-$1').toLowerCase();
export const isQuasarComponent = (tag) => hyphenate(tag).startsWith('q-');

/**
 * A palette name as the WHOLE value of such a prop, and as a string inside a
 * bound one.
 *
 * Two patterns, because the two attribute kinds hold different languages — the
 * same split `templateColourSites` makes for `fill="white"` against
 * `:fill="ok ? 'green' : 'red'"`. Leaving the bound half out would put the hole
 * where a contributor can route around the ratchet: the package already writes
 * plenty of these as a ternary, and `:color="isRegression ? 'negative' :
 * 'positive'"` is exactly as much a palette decision as `color="negative"`.
 *
 * A quoted string is read only because the ATTRIBUTE already said it is a
 * colour. That is what makes it safe here and not in general: `'primary'`
 * anywhere else in a template is a word, but inside a binding named `color` it
 * is Quasar's palette. `:color="statusColor(row)"` names nothing and is not a
 * finding — the value lives in a script, where no template pass can reach it.
 *
 * It used to over-read in one shape, knowingly: a string COMPARED inside such a
 * binding — `:color="mode === 'dark' ? 'negative' : 'primary'"` — counted three
 * where two were written, because `dark` is a palette name as well as a theme.
 * `withComparedStringsBlanked` narrows that, and only that: the operand of an
 * equality comparison is dropped before this pattern runs, which is derived from
 * the operator rather than from a list of the strings that cannot reach a value.
 * What remains over-read is a string an expression can hold without emitting for
 * some other reason, and reading that needs the expression parsed rather than
 * scanned.
 *
 * The direction still decides how much of this to attempt: the metric is a
 * ratchet rather than a floor of zero, so an over-read costs a re-record while a
 * hole costs the rule — a `color="negative"` rewritten as a ternary would
 * otherwise leave the number by itself. That is why the narrowing is the
 * comparison and nothing beyond it.
 *
 * Both are anchored — `^…$` on one, the closing quote backreference on the
 * other — so the alternation is safe unordered and `blue-grey-7` cannot be read
 * as `blue`.
 */
const QUASAR_PALETTE_VALUE = new RegExp(`^(?:${QUASAR_PALETTE_NAMES.join('|')})(?:-\\d{1,2})?$`);
const QUOTED_PALETTE_VALUE = new RegExp(
    `(['"\`])\\s*((?:${QUASAR_PALETTE_NAMES.join('|')})(?:-\\d{1,2})?)\\s*\\1`,
    'g',
);

/**
 * Vue's `Namespaces.SVG`. The parser tracks it, so nothing here has to.
 *
 * This replaced a hand-kept list of twenty SVG tags, and the list was wrong in
 * the way every such list is: `filter`, `feFlood`, `feColorMatrix` and two dozen
 * others were missing, so `<filter color="#fff">` — which is what a
 * `flood-color: currentColor` below it resolves against — read as a component
 * prop and went uncounted. A namespace is the actual question; a tag list is a
 * guess at its answer, and it is never finished.
 *
 * `foreignObject` is the case that proves the parser is doing it properly: its
 * children are HTML again, and the AST says so.
 */
const SVG_NAMESPACE = 1;

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
const URL_FRAGMENT = /url\([^)]*\)/gi;

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

/**
 * What a `font:` shorthand names outside a `var()`, if anything.
 *
 * The blind spot one property over from the one this file was fixed for, and
 * the same shape: `font: 700 40px/1 var(--sa-font-head)` sets a weight, a size
 * and a line height in one declaration, and the three patterns that read those
 * are each anchored on the LONGHAND name — so all three read past it. How many
 * the package writes is printed by `pnpm tokens` and pinned in
 * `design-token-baseline.json`; a number here would be a fourth place to keep
 * it in step, and the first to fall out.
 *
 * Derived rather than parsed against the shorthand's grammar, which is genuinely
 * awkward (four optional components in any order, then a size, then an optional
 * `/leading`, then the family). The question that matters is simpler and does
 * not need the grammar: strip every `var()` and see whether a NUMBER is left.
 * `font: var(--sa-text-md) var(--sa-font-body)` leaves none, `font: inherit`
 * leaves none, and `font: 700 var(--sa-text-sm) var(--sa-font-body)` leaves the
 * weight — which is exactly the literal that should have been a token.
 *
 * Counted, not forbidden, for the same reason `font-weight: 800` is: the one
 * literal SIZE among them is `40px`, and the type scale stops at 32. Deciding
 * that is a decision about the scale, not about this script.
 *
 * @returns {null | string} the declaration value, whitespace-collapsed
 */
export function fontShorthandLiteral(value) {
    const font = value.replace(/\s+/g, ' ').trim();
    // One level of nesting is all a `var(--x, var(--y))` fallback needs.
    const outsideTokens = font.replace(/var\((?:[^()]|\([^()]*\))*\)/g, ' ');
    // The family comes last in the shorthand and is not a scale decision. A
    // family whose name carries a number has to be quoted — CSS forbids a bare
    // numeric component in an identifier — so dropping quoted strings removes
    // exactly the digits that are a name rather than a size. Without this,
    // `font: var(--sa-text-md) "Source Sans 3"` reads as a literal and the
    // ratchet forbids adopting a numbered family whose type size is fully
    // tokenized.
    const outsideNames = outsideTokens.replace(/'[^']*'|"[^"]*"/g, ' ');
    return /\d/.test(outsideNames) ? font : null;
}

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
 * Every attribute a TEMPLATE writes, static or bound, with the line its value
 * starts on and the namespace of the element carrying it.
 *
 * The template is the third place a design decision can be written, and for a
 * long time it was the only one nothing read. The headline of this report was
 * `hard-coded hex colours 0 in 0 files` while twelve of them sat in six
 * templates: three browser-chrome dots written out twice, three diff markers
 * reaching past the token layers for a primitive, and three
 * `p.color ?? '#94a3b8'` fallbacks that answered one question with two different
 * greys. A zero that is wrong is worse than a number that is large, because it
 * ends the search.
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
 * ONE walk, feeding every template-side category. Three readers want three
 * different attributes out of the same tree — paint, an inline stylesheet, a
 * class list — and a second walk per category is how they end up disagreeing
 * about which node they saw.
 *
 * The element's TAG and namespace travel with each attribute, because for two
 * of the three readers the attribute's name is only half the question: `color`
 * is paint on an SVG element and a palette name on a Quasar component, and
 * dropping the tag made every element a Quasar component.
 *
 * @returns {null | {tag: string, name: string, value: string, line: number,
 *          isStatic: boolean, ns: number}[]} null if the file is not an SFC or
 *          did not parse — the caller counts that, so a template the audit
 *          stopped reading cannot look like a template with no findings.
 */
function templateAttributes(file, content) {
    if (!file.endsWith('.vue')) return null;
    const { descriptor, errors } = parse(content, { ignoreEmpty: false });
    if (errors.length > 0 || !descriptor.template?.ast) return null;

    const attributes = [];
    const visit = (node) => {
        // ELEMENT === 1. Only an element carries props.
        if (node.type === 1) {
            for (const prop of node.props ?? []) {
                // ATTRIBUTE === 6 — `style="background: #ef4444"`.
                if (prop.type === 6 && prop.value) {
                    attributes.push({
                        tag: node.tag,
                        name: prop.name,
                        value: prop.value.content,
                        line: prop.value.loc.start.line,
                        isStatic: true,
                        ns: node.ns,
                    });
                }
                // DIRECTIVE === 7 — `:style` is v-bind with `style` as its arg.
                // The expression is JavaScript, so what a reader finds here is
                // the literal inside it: `p.color ?? '#94a3b8'` names a colour,
                // and `{ background: p.color }` names none.
                //
                // `arg.isStatic` because a DYNAMIC argument carries the
                // variable's name, not the attribute's: in `:[style]="x"` the
                // arg reads `style` and the attribute is whatever that variable
                // holds.
                if (prop.type === 7 && prop.name === 'bind' && prop.arg?.isStatic && prop.exp) {
                    attributes.push({
                        tag: node.tag,
                        name: prop.arg.content,
                        value: prop.exp.content,
                        line: prop.exp.loc.start.line,
                        isStatic: false,
                        ns: node.ns,
                    });
                }
                // `v-bind="{ color: 'grey-7' }"` has no arg, and Vue emits the
                // props all the same. Reading only the arg form let the object
                // form past every reader below — the same decision, written the
                // other way. Only literal values are taken: a key whose value is
                // an expression names no colour and no length here either.
                if (prop.type === 7 && prop.name === 'bind' && !prop.arg && prop.exp) {
                    for (const entry of objectLiteralEntries(prop.exp.content)) {
                        attributes.push({
                            tag: node.tag,
                            name: entry.key,
                            value: entry.raw,
                            line: prop.exp.loc.start.line,
                            isStatic: false,
                            ns: node.ns,
                        });
                    }
                }
            }
        }
        for (const child of node.children ?? []) visit(child);
    };
    for (const child of descriptor.template.ast.children ?? []) visit(child);
    return attributes;
}

/**
 * The `key: 'literal'` pairs of an object expression, with the value's own
 * quotes kept so a reader downstream sees what a bound attribute would give it.
 *
 * Deliberately literal-only. A value built by an expression names nothing this
 * file can count, and guessing at it would be the over-read the colour readers
 * already refuse.
 */
const OBJECT_ENTRY_KEY = /(?:'([^']*)'|"([^"]*)"|([A-Za-z_$][\w$-]*))\s*:\s*/y;
const OBJECT_ENTRY_VALUE = /'[^']*'|"[^"]*"|`[^`$]*`/y;

export function objectLiteralEntries(expression) {
    const text = expression.trim();
    if (text[0] !== '{') return [];
    const entries = [];
    let depth = 0;
    let index = 0;
    // Walked rather than matched globally: a global pattern resumes at every
    // `{`, so `v-bind="{ options: { color: 'primary' } }"` reported `color` as
    // a prop on the component while Vue binds only `options`. Depth is what
    // separates the two, and a nested value is not a prop at all.
    while (index < text.length) {
        const char = text[index];
        if ('{(['.includes(char)) {
            depth += 1;
            index += 1;
            continue;
        }
        if ('})]'.includes(char)) {
            depth -= 1;
            index += 1;
            continue;
        }
        if (depth !== 1 || /\s|,/.test(char)) {
            index += 1;
            continue;
        }
        OBJECT_ENTRY_KEY.lastIndex = index;
        const key = OBJECT_ENTRY_KEY.exec(text);
        if (!key) {
            index += 1;
            continue;
        }
        OBJECT_ENTRY_VALUE.lastIndex = OBJECT_ENTRY_KEY.lastIndex;
        const value = OBJECT_ENTRY_VALUE.exec(text);
        if (value) entries.push({ key: key[1] ?? key[2] ?? key[3], raw: value[0] });
        index = value ? OBJECT_ENTRY_VALUE.lastIndex : OBJECT_ENTRY_KEY.lastIndex;
    }
    return entries;
}

/**
 * The text of an expression that is nothing but one string literal, or null.
 *
 * `:style="'font-size: 22px'"` is inline CSS Vue applies verbatim; it is bound,
 * so `isStatic` is false, and a reader that filters on that misses a real
 * declaration. A literal carrying `${` is left alone — its value is not known
 * here.
 */
export function constantStringValue(expression) {
    const text = expression.trim();
    const quote = text[0];
    if (!["'", '"', '`'].includes(quote) || text.at(-1) !== quote || text.length < 2) return null;
    const body = text.slice(1, -1);
    if (body.includes(quote) || (quote === '`' && body.includes('${'))) return null;
    return body;
}

/**
 * The attributes of that set which PAINT.
 *
 * @returns {null | {value: string, line: number, attribute: string,
 *          isStatic: boolean}[]}
 */
function templatePaint(file, content) {
    const attributes = templateAttributes(file, content);
    if (attributes === null) return null;
    return attributes
        .filter(
            // `color` paints inside SVG and names a Quasar palette entry
            // everywhere else, so the namespace has to be part of the question.
            ({ name, ns }) =>
                PAINT_ATTRIBUTES.has(name) || (name === 'color' && ns === SVG_NAMESPACE),
        )
        .map(({ name, value, line, isStatic }) => ({ value, line, attribute: name, isStatic }));
}

/**
 * The inline stylesheets a template writes: every STATIC `style="…"`.
 *
 * A `style` attribute is a stylesheet fragment that happens to live in a
 * template, and until this existed the audit read it with one eye. It walked
 * the AST, pulled the attribute out, and then applied only the colour patterns
 * to it — so `style="font-size: 22px"` was invisible to `distinctFontSizes`,
 * `style="margin-top: 6px"` to `scalePixels`, and the report answered `0` to a
 * question it had never asked. That number then reached `docs/design-guide.md`
 * as a published claim, which is the combination that costs the most: a guard
 * satisfied exactly in the damaging case, and a sentence about it.
 *
 * STATIC only, and the boundary is not laziness. A bound `:style` is
 * JavaScript: its keys are camelCase, its separators are commas, and its values
 * are expressions — reading it as CSS attributes the second key's value to the
 * first key's property, so `{ minWidth: '200px', marginTop: '8px' }` would file
 * a spacing literal under a dimension. `templateColourSites` can read a bound
 * binding because a colour LITERAL is the same string in either language and
 * needs no property to be recognised; a length is not, and only the property
 * says whether `8px` is debt on a scale or a measurement taken once.
 *
 * Exported so `theme-layer-discipline.test.js` reads the same fragments with
 * the same parser. Two answers to "where does this package write CSS" is how
 * the ratchet and the rule end up guarding different files.
 *
 * @returns {null | {text: string, line: number}[]} null propagates the "did not
 *          parse" state, which must not read as "has no inline styles".
 */
export function inlineStyleFragments(file, content) {
    const attributes = templateAttributes(file, content);
    if (attributes === null) return null;
    return attributes
        .filter(({ name }) => name === 'style')
        .map(({ value, line, isStatic }) => ({
            // A bound style whose expression is one string literal is inline CSS
            // as much as a static attribute is; an object form (`:style="{…}"`)
            // is JavaScript and is left to the colour reader, which knows how to
            // pick literals out of it without mistaking a key for a property.
            text: isStatic ? value : constantStringValue(value),
            line,
        }))
        .filter(({ text }) => text !== null);
}

/**
 * The string operands of an equality comparison, blanked.
 *
 * A bound attribute is read for the literals it holds, because a class name and
 * a palette name cannot be built by an expression without one appearing. A
 * string the expression COMPARES is the shape that appears without being
 * emitted: `:class="tone === 'text-grey-7' ? 'muted' : ''"` renders `muted`, and
 * the class-shaped string is data being tested — so counting it turns an
 * unrelated state comparison into a palette decision, on two metrics that are
 * ratchets and can therefore fail on it.
 *
 * The OPERATOR decides, which is what keeps this from being a list: a string on
 * either side of `===`, `==`, `!==` or `!=` is an operand, and everything else a
 * binding holds is left exactly as it was. That is deliberately less than
 * knowing which strings can reach a value position — `tones[key]`,
 * `\`text-${hue}\``, a name assembled in a script — which needs the expression
 * parsed rather than scanned, and that boundary is #158's.
 *
 * Blanked to equal-length spaces rather than removed, like every other pre-pass
 * in this file: the line a finding reports is an offset into this text. A string
 * never spans a newline here, so the offsets survive exactly.
 *
 * Neither operator is consumed, which is what lets `'a' === 'b'` lose both of
 * its operands rather than only the one the scan reached first.
 *
 * One layer of grouping is allowed on either side. `tone === ('text-grey-7')`
 * and `('dark') === mode` are the same comparison written with parentheses, and
 * a pattern that demanded the quote touch the operator left the operand
 * counted — the false positive this helper exists to remove, one character
 * further out.
 */
const COMPARED_STRING =
    /(['"`])(?:(?!\1)[^\n])*\1(?=\s*\)*\s*[=!]==?)|(?<=[=!]==?\s*\(?\s*)(['"`])(?:(?!\2)[^\n])*\2/g;

export function withComparedStringsBlanked(text) {
    return text.replace(COMPARED_STRING, (match) => ' '.repeat(match.length));
}

/**
 * Quasar colour classes in a template's `class` lists.
 *
 * Exported for its own test. Reads `class` and `:class` alike: a bound class
 * list holds its literals as strings (`['chip', ok ? 'text-positive' : '']`),
 * and a class name cannot be built by an expression without one appearing.
 *
 * @returns {null | {value: string, line: number}[]}
 */
export function templateColourClasses(file, content) {
    const attributes = templateAttributes(file, content);
    if (attributes === null) return null;

    const sites = [];
    for (const { name, value, line } of attributes) {
        if (name !== 'class') continue;
        // A bound list is JavaScript and can carry a `//` comment; a static one
        // cannot, and blanking is harmless there. A compared string goes the
        // same way and for the same reason the comment does: it is in the
        // expression without being in the rendered class list.
        const text = withComparedStringsBlanked(
            withCommentsBlanked(value).replace(
                /(^|\s)\/\/[^\n]*/g,
                (m, lead) => lead + ' '.repeat(m.length - lead.length),
            ),
        );
        for (const match of text.matchAll(QUASAR_COLOUR_CLASS)) {
            sites.push({ line: line + lineOf(text, match.index) - 1, value: match[0] });
        }
    }
    return sites.sort((a, b) => a.line - b.line);
}

/**
 * Quasar palette names in a template's colour PROPS.
 *
 * The blind spot one attribute over from the class above, and the same shape:
 * `<q-icon color="grey-7">` renders `class="text-grey-7"`, which is literally
 * what `templateColourClasses` counts — so the class form was debt and the prop
 * form, which produces it, was not. The comment on the palette list used to say
 * this was the one place no pattern could see, while a pattern one constant
 * away was reading the class it compiles to.
 *
 * The tag is part of the question here and not for the class above, and the
 * asymmetry is real rather than an oversight: `text-grey-7` is a utility class
 * Quasar's stylesheet applies to any element, so who wears it does not change
 * what it means, while `color` is a component's prop and means Quasar's palette
 * only on a component of Quasar's.
 *
 * Exported for its own test.
 *
 * @returns {null | {value: string, line: number}[]}
 */
export function templatePaletteProps(file, content) {
    const attributes = templateAttributes(file, content);
    if (attributes === null) return null;

    const sites = [];
    for (const { tag, name, value, line, isStatic } of attributes) {
        // Which also settles `color` inside SVG, where it is a CSS property
        // rather than a Quasar prop and `templateColourSites` reads it as
        // paint: no SVG element is one of Quasar's components, so the two
        // passes stay disjoint without either naming the other's namespace.
        if (!isQuasarComponent(tag)) continue;
        if (!isQuasarPaletteAttribute(name)) continue;
        if (isStatic) {
            const trimmed = value.trim();
            if (QUASAR_PALETTE_VALUE.test(trimmed)) sites.push({ line, value: trimmed });
            continue;
        }
        // A bound value is JavaScript and can carry a `//` comment; the idiom
        // is the one the alpha-concat sweep uses, so the `//` in a URL survives.
        // A compared string is dropped for the same reason, and by the same
        // helper the class list uses — one over-read, not two answers to it.
        const text = withComparedStringsBlanked(
            withCommentsBlanked(value).replace(
                /(^|\s)\/\/[^\n]*/g,
                (m, lead) => lead + ' '.repeat(m.length - lead.length),
            ),
        );
        for (const match of text.matchAll(QUOTED_PALETTE_VALUE)) {
            sites.push({ line: line + lineOf(text, match.index) - 1, value: match[2] });
        }
    }
    return sites.sort((a, b) => a.line - b.line);
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
        // Two things in an attribute value are not paint, and both are blanked
        // rather than removed so `at()` still lands on the right line.
        //
        // A COMMENT is prose. `style="/* was #fff */ color: var(--x)"` is a
        // clean component, and counting the explanation would REJECT it under a
        // floor of zero — the direction that a contributor cannot fix by
        // writing better code. The stylesheet pass has blanked comments since
        // the same thing happened there; this is the same helper, and it is
        // quote-aware, so `content: "/*"` opens nothing. A bound value is
        // JavaScript and also has `//`, blanked with the idiom the alpha-concat
        // sweep already uses — whitespace or a line start in front of it, so
        // the `//` in `https://` survives.
        //
        // A `url()` is an address, and its fragment can spell a colour:
        // `fill="url(#facade)"` points at a paint server, not at a hex.
        const commentless = isStatic
            ? withCommentsBlanked(value)
            : withCommentsBlanked(value).replace(
                  /(^|\s)\/\/[^\n]*/g,
                  (m, lead) => lead + ' '.repeat(m.length - lead.length),
              );
        const paint = commentless.replace(URL_FRAGMENT, (m) => ' '.repeat(m.length));

        for (const pattern of COLOUR_PATTERNS) {
            for (const match of paint.matchAll(pattern)) {
                const found =
                    pattern === CATEGORIES.namedColor ? namedColourValue(match) : match[0];
                if (found === null) continue;
                sites.push({ line: at(line, paint, match.index), value: found.trim() });
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

/**
 * @param {string} [root] the tree to sweep. Defaults to the package this audit
 *        is for; the budget test points it at a fixture instead, because every
 *        number below is allowed to reach zero — so over the package alone,
 *        "the sweep found nothing" and "the sweep is broken" are the same
 *        report. Proving a pass is alive needs a tree that cannot go clean.
 */
export function audit(root = UI_SRC) {
    const files = walk(
        root,
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
    //
    // `inlineStyles` is the newest of these and exists because the sweep it
    // counts was missing entirely: the pixel and font-size numbers below moved
    // the day it was added, and without a reach counter that movement is
    // indistinguishable from debt arriving. It also answers the reverse
    // question later — a filter that stops matching `style` attributes takes
    // this to 0 while every budget stays green.
    const reach = { files: 0, styleBlocks: 0, vueFiles: 0, templates: 0, inlineStyles: 0 };

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

            const classes = templateColourClasses(file, content);
            if (classes !== null && !isTokenDefinition) {
                for (const site of classes) findings.quasarColorClass.push({ file: rel, ...site });
            }

            const props = templatePaletteProps(file, content);
            if (props !== null && !isTokenDefinition) {
                for (const site of props) findings.quasarColorProp.push({ file: rel, ...site });
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

        // Every place this file writes CSS, with the way to turn an index in it
        // back into a line in the file.
        //
        // A `<style>` block and an inline `style="…"` are the same language and
        // carry the same debt, and for a long time only the first was read as
        // such: the template pass pulled the attribute out of the AST and then
        // applied nothing but the colour patterns to it. Both passes below now
        // read both, which is the whole of this fix.
        //
        // `lineAt` rather than a shared offset, because the two sources answer
        // "where am I" differently: a block knows its byte offset in the file,
        // an attribute knows the line its value starts on and nothing more
        // exact (Vue's `loc` spans the quotes, and an entity in the value would
        // move the rest of it). Line is what every finding reports anyway.
        const inline = inlineStyleFragments(file, content) ?? [];
        reach.inlineStyles += inline.length;
        const styleSources = [
            ...styleBlocks(file, content).map(({ text, offset }) => ({
                text,
                lineAt: (index) => lineOf(content, offset + index),
                // `hexColor` and its two siblings own a `<style>` block.
                // Inside a template `templateColor` owns them, and it reaches
                // further than this pass can — a bound `:style`, a bare
                // `fill="white"`. Reading them here as well would count the
                // same literal under two metrics.
                readColours: true,
            })),
            ...inline.map(({ text, line }) => ({
                text,
                lineAt: (index) => line + lineOf(text, index) - 1,
                readColours: false,
            })),
        ];

        // Per DECLARATION, not per regex hit: only the property can say whether
        // a scale has the answer, and the shared parser is what the codemods
        // read too.
        //
        // The trailing `}` terminates the last declaration. A `<style>` block
        // already ends with one and gains an empty chunk the parser drops; an
        // attribute is a bare declaration list with no terminator at all, so
        // without this `style="margin-top: 6px"` parses to nothing.
        for (const { text, lineAt } of styleSources) {
            for (const declaration of declarations(`${text}}`)) {
                const property = declaration.property.toLowerCase();
                const scaled = SCALE_PROPERTY.test(property);
                for (const match of declaration.value.matchAll(CATEGORIES.pixelValue)) {
                    if (ALWAYS_ALLOWED_PX.has(match[0])) continue;
                    if (!scaled && HAIRLINE_PX.has(match[0])) continue;
                    const where = {
                        file: rel,
                        line: lineAt(declaration.valueStart + match.index),
                        value: match[0],
                        property: declaration.property,
                    };
                    findings[scaled ? 'scalePixel' : 'dimensionPixel'].push(where);
                }
                // Here rather than in the pattern pass below, because only the
                // property says this is a shorthand and only the whole value
                // says whether it names anything the tokens should have said.
                if (property === 'font') {
                    const literal = fontShorthandLiteral(declaration.value);
                    if (literal !== null) {
                        findings.fontShorthand.push({
                            file: rel,
                            line: lineAt(declaration.valueStart),
                            value: literal,
                        });
                    }
                }
            }
        }

        for (const { text: source, lineAt, readColours } of styleSources) {
            // Comments blanked, and the same way the declaration pass above
            // blanks them, so the two halves of this file agree about what is
            // paint. Reading the raw text made a rule's own documentation the
            // first thing it flagged — `#f59e0b` inside a comment explaining
            // why `#f59e0b` may not be written was a hard-coded colour.
            // Blanked rather than stripped: `lineAt` is an index into the
            // original text.
            //
            // A `url()` goes the same way, and for the same reason the template
            // pass blanks it: `background-image: url("/assets/red.svg")` is an
            // address. That the two passes disagreed about this was an
            // asymmetry introduced here, not an oversight inherited — the
            // template half learned it first and this half did not, which is
            // how a clean stylesheet would have been REJECTED by a zero floor.
            const text = withCommentsBlanked(source).replace(URL_FRAGMENT, (m) =>
                ' '.repeat(m.length),
            );
            for (const [category, pattern] of Object.entries(CATEGORIES)) {
                if (category === 'selfReferencingVar') continue;
                if (!readColours && COLOUR_CATEGORIES.has(category)) continue;
                for (const match of text.matchAll(pattern)) {
                    const named = category === 'namedColor' ? namedColourValue(match) : undefined;
                    if (named === null) continue;
                    const value = (named ?? match[1] ?? match[0]).trim();
                    if (category === 'pixelValue' && ALWAYS_ALLOWED_PX.has(value)) continue;
                    // A `var(--sa-…)` is the goal, not a finding.
                    if (value.startsWith('var(')) continue;
                    // And a CSS-wide keyword is not a value at all — the same
                    // shape as the guard above it, and asked of the value
                    // rather than of the category for the same reason: no
                    // pattern here can match a hex, a colour function, a length
                    // or a breakpoint IN one, so this can only ever quiet the
                    // categories that read a whole declaration value.
                    if (isCssWideKeyword(value)) continue;
                    findings[category].push({
                        file: rel,
                        line: lineAt(match.index),
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
        // Totals, where the three above the line are `distinct` counts. The
        // question is a different one: a type scale is finished when nobody
        // writes a SIZE, and `--sa-weight-*` is finished when nobody writes a
        // WEIGHT. A distinct count barely moves while that happens —
        // `font-weight` reads the same handful of values with every site
        // outstanding and with one site left.
        fontWeights: { total: findings.fontWeight.length, files: files(findings.fontWeight) },
        lineHeights: { total: findings.lineHeight.length, files: files(findings.lineHeight) },
        letterSpacings: {
            total: findings.letterSpacing.length,
            files: files(findings.letterSpacing),
        },
        // The declarations the three above cannot see, because the shorthand
        // uses none of their names.
        fontShorthands: {
            total: findings.fontShorthand.length,
            files: files(findings.fontShorthand),
        },
        quasarColorClasses: {
            total: findings.quasarColorClass.length,
            files: files(findings.quasarColorClass),
        },
        quasarColorProps: {
            total: findings.quasarColorProp.length,
            files: files(findings.quasarColorProp),
        },
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
        `  font-weight literals       ${summary.fontWeights.total} in ${summary.fontWeights.files} files`,
    );
    console.log(
        `  line-height literals       ${summary.lineHeights.total} in ${summary.lineHeights.files} files`,
    );
    console.log(
        `  letter-spacing literals    ${summary.letterSpacings.total} in ${summary.letterSpacings.files} files`,
    );
    console.log(
        `  font: shorthand literals   ${summary.fontShorthands.total} in ${summary.fontShorthands.files} files`,
    );
    console.log(
        `  Quasar colour classes      ${summary.quasarColorClasses.total} in ${summary.quasarColorClasses.files} files`,
    );
    console.log(
        `  Quasar palette props       ${summary.quasarColorProps.total} in ${summary.quasarColorProps.files} files`,
    );
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
    printTop('font weights', result.findings.fontWeight);
    printTop('line heights', result.findings.lineHeight);
    printTop('letter spacings', result.findings.letterSpacing);
    printTop('font: shorthands', result.findings.fontShorthand);
    printTop('Quasar colour classes', result.findings.quasarColorClass);
    printTop('Quasar palette props', result.findings.quasarColorProp);
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
