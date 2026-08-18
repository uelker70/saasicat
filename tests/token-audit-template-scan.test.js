import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    inlineStyleFragments,
    templateColourClasses,
    templateColourSites,
    templatePaletteProps,
    fontShorthandLiteral,
} from '../scripts/token-audit.mjs';

// The template half of the colour audit, under test — because the metric it
// feeds is allowed to read zero, and a broken scanner reads zero too.
//
// The audit's headline was `hard-coded hex colours 0 in 0 files` while twelve
// literals sat in six templates. It only ever read `<style>` blocks and
// `<script>` blocks; the third place a colour can be written had no category at
// all. A zero that is wrong is worse than a large number, because it ends the
// search — nobody looks for debt a report says is not there.
//
// Two properties decide whether this pass is worth having, and each has its own
// group below:
//
//   1. It finds a colour written as paint, wherever in the tree it sits.
//   2. It stays silent about every OTHER thing a `#` means in a template.
//
// The second is the harder one and it is why this reads an AST rather than the
// template's text. A slot is `#actions`, an input mask is `mask="######"`, an
// anchor is `href="#top"` and a pull request is `(#124)` in a comment. None is
// a colour, all of them look like one to a pattern, and the repo's own numbers
// are already four digits.

/** A minimal SFC; `body` becomes the template. */
const sfc = (body, extra = '') => `<template>\n${body}\n</template>\n${extra}`;

const found = (body, extra) => templateColourSites('A.vue', sfc(body, extra));
const values = (body, extra) => found(body, extra).map((s) => s.value);
const fragments = (body, extra) => inlineStyleFragments('A.vue', sfc(body, extra));
const classes = (body, extra) =>
    templateColourClasses('A.vue', sfc(body, extra)).map((s) => s.value);
const props = (body, extra) => templatePaletteProps('A.vue', sfc(body, extra)).map((s) => s.value);

describe('a colour written as paint is found', () => {
    test('a static style attribute', () => {
        assert.deepEqual(values('<span style="background: #ef4444" />'), ['#ef4444']);
    });

    test('a bound style with a literal fallback', () => {
        // The exact shape of three of the twelve: a stored colour, or a grey
        // when the row has none. The grey is the literal.
        assert.deepEqual(values(`<span :style="{ background: p.color ?? '#94a3b8' }" />`), [
            '#94a3b8',
        ]);
    });

    test('an SVG paint attribute', () => {
        assert.deepEqual(values('<svg><path fill="#123456" stroke="#abc" /></svg>'), [
            '#123456',
            '#abc',
        ]);
    });

    test('a functional notation with literal channels', () => {
        assert.deepEqual(values('<i style="background: rgba(0, 0, 0, .5)" />'), [
            'rgba(0, 0, 0, .5)',
        ]);
    });

    test('a named colour is a literal too', () => {
        // It hid from both patterns above for the whole migration. Reported as
        // the value rather than the whole declaration, like the stylesheet pass.
        assert.deepEqual(values('<i style="background: white" />'), ['white']);
    });

    test('a named colour BARE in an SVG paint attribute', () => {
        // The gap review found. `fill="white"` is a value with no property in
        // front of it, and the named-colour pattern is anchored on `property:`
        // — so this category read `fill` and `stroke` as paint, found their
        // hexes, and let a keyword through under a zero floor. Three notations
        // out of four is not a guard.
        assert.deepEqual(values('<svg><path fill="white" stroke="red" /></svg>'), ['white', 'red']);
    });

    test('a named colour as a string inside a bound paint attribute', () => {
        assert.deepEqual(values(`<svg><path :fill="ok ? 'green' : 'red'" /></svg>`), [
            "'green'",
            "'red'",
        ]);
    });

    test('the two halves do not report the same colour twice', () => {
        // `style` holds declarations and the property-anchored pattern already
        // reads them; the bare check must not fire there as well.
        assert.deepEqual(values('<i style="fill: white" />'), ['white']);
    });

    test('`color` inside SVG is paint', () => {
        // The other half of the `color` question. Excluding the attribute
        // outright was right for a component and wrong inside SVG: `color`
        // establishes what `currentColor` resolves to, so a literal there
        // paints every glyph below it — and this scanner read `fill` and
        // `stroke` while walking past the thing that feeds them.
        assert.deepEqual(values('<svg color="#fff"><path fill="currentColor" /></svg>'), ['#fff']);
        assert.deepEqual(values('<svg><g color="red"><path fill="currentColor" /></g></svg>'), [
            'red',
        ]);
    });

    test('the namespace, not the tag name — a bare <g> is not SVG', () => {
        // Written first as `<g color="red">` at the top level, which FAILED,
        // and the code was right: outside an `<svg>` there is no SVG namespace,
        // so `g` is an unknown HTML element and `color` is a component prop
        // again. A tag list would have said "SVG" and been wrong.
        assert.deepEqual(values('<g color="red" />'), []);
    });

    test('`color` on the SVG elements a tag list forgets', () => {
        // The first version of this used a hand-kept list of twenty tags, and
        // `filter` was not among them — nor were the two dozen `fe*` elements.
        // The namespace is the actual question; a tag list is a guess at its
        // answer and is never finished.
        assert.deepEqual(
            values(
                '<svg><filter color="#fff"><feFlood flood-color="currentColor" /></filter></svg>',
            ),
            ['#fff'],
        );
    });

    test('every CSS named colour, not the obvious eighteen', () => {
        // A floor of zero with a hole in it: `gold` and `pink` are literals the
        // budget claimed to forbid and never saw.
        assert.deepEqual(values('<svg><path fill="pink" stroke="gold" /></svg>'), ['pink', 'gold']);
        assert.deepEqual(values('<i style="background: rebeccapurple" />'), ['rebeccapurple']);
    });

    test('a longer keyword is not read as the shorter one inside it', () => {
        // `blue` is in the list and so is `blueviolet`. The bound on each
        // pattern is what keeps the alternation safe unordered.
        assert.deepEqual(values('<svg><path fill="blueviolet" /></svg>'), ['blueviolet']);
    });

    test('several literals in one binding', () => {
        assert.deepEqual(values(`<i :style="{ background: '#fff', color: '#000' }" />`), [
            '#fff',
            '#000',
        ]);
    });

    test('a literal nested deep in the tree', () => {
        assert.deepEqual(
            values('<div><ul><li><b><span style="fill: #0f0" /></b></li></ul></div>'),
            ['#0f0'],
        );
    });

    test('a literal AFTER a nested <template>', () => {
        // The reason this reads an AST and not a `<template>…</template>`
        // match: `v-if` blocks are templates too, and a non-greedy pattern
        // ends the block at the first nested closing tag. Everything after it
        // then reads as clean — silent under-reach, in the pass whose whole job
        // is "find every site".
        assert.deepEqual(
            values('<template v-if="x"><i /></template>\n<span style="background: #beef00" />'),
            ['#beef00'],
        );
    });
});

describe('everything else a # means in a template stays silent', () => {
    test('a hex in template TEXT is content, not paint', () => {
        assert.deepEqual(values('<code>#abcdef</code>'), []);
    });

    test('a pull-request number in an HTML comment', () => {
        // Latent until the repo's numbers reach six hex-shaped digits — and the
        // package already writes `(#124)` in template comments today. A text
        // scan needs a stripping pass to survive this; an AST never sees it,
        // because a comment is its own node type.
        assert.deepEqual(values('<!-- fixed in (#a1b2c3), see also (#124) -->\n<i />'), []);
    });

    test('a slot shorthand that happens to spell a colour', () => {
        // `#feed`, `#beef`, `#cafe`, `#add` are all legal slot names and all
        // match `#[0-9a-f]{3,8}`.
        assert.deepEqual(values('<q-table><template #feed><i /></template></q-table>'), []);
    });

    test('an input mask', () => {
        assert.deepEqual(values('<q-input mask="####-##-##" />'), []);
    });

    test('an anchor href', () => {
        assert.deepEqual(values('<a href="#abc123">x</a>'), []);
    });

    test('a Quasar `color` prop names a palette entry, not a colour', () => {
        // The counterpart to "`color` on a native SVG element is paint" above:
        // the same attribute means two things, and the TAG is what separates
        // them. On a component `color="primary"` is Quasar's vocabulary, and a
        // hex written there paints nothing anyway — Quasar turns it into a
        // `text-#fff` class. That is a bug for a different check.
        assert.deepEqual(values('<q-btn color="primary" /><q-icon color="#fff" />'), []);
    });

    test('a var() is the goal, not a finding', () => {
        assert.deepEqual(values('<i style="background: var(--sa-color-negative-strong)" />'), []);
    });

    test('a functional notation with a var() channel is a token in use', () => {
        assert.deepEqual(
            values('<i style="box-shadow: 0 1px rgb(var(--sa-shadow-ink) / 6%)" />'),
            [],
        );
    });

    test('a binding that carries data rather than a literal', () => {
        assert.deepEqual(values('<i :style="{ background: planAccentFor(row) }" />'), []);
    });

    test('the SVG keywords that are not colours', () => {
        // `none` and `currentColor` are the two things an SVG paint attribute
        // holds in this package today, and both are correct.
        assert.deepEqual(values('<svg><path fill="none" stroke="currentColor" /></svg>'), []);
    });

    test('a paint-server reference is an address, not a colour', () => {
        // A same-document paint server can be named anything, and `#facade`,
        // `#abc` and `#dedede` are all legal ids that spell hex.
        //
        // The first version of this test used `url(#g)` — a ONE-character id,
        // which `#[0-9a-fA-F]{3,8}` could never have matched. It passed against
        // a scanner with no protection at all, which makes it the exact shape
        // this file exists to argue against: a green tick over an open hole.
        assert.deepEqual(values('<svg><rect fill="url(#facade)" stroke="url(#abc)" /></svg>'), []);
        assert.deepEqual(values('<i style="background: url(#dedede) center/cover" />'), []);
    });

    test('a CSS function name is case-insensitive', () => {
        // `URL(#abc)` is valid CSS, and without the `i` flag it was not blanked
        // — so a clean component would have been REJECTED by a floor of zero.
        // The other direction from everything else in this group, and the more
        // annoying one: a false positive nobody can fix by editing their code.
        assert.deepEqual(values('<svg><rect fill="URL(#abc)" stroke="Url(#facade)" /></svg>'), []);
    });

    test('a comment in a style attribute is prose, not paint', () => {
        // The other false-positive direction, and the one that would reject a
        // CLEAN component: the sentence explaining which literal a token
        // replaced is not the literal. The stylesheet pass has blanked comments
        // since the same thing happened there — over a comment of mine that
        // quoted `#f59e0b` in order to forbid it.
        assert.deepEqual(values('<i style="/* was #fff */ color: var(--sa-color-fg-body)" />'), []);
        assert.deepEqual(values(`<i :style="{ /* was '#fff' */ color: token }" />`), []);
        assert.deepEqual(values(`<i :style="{\n  // was '#fff'\n  color: token,\n}" />`), []);
    });

    test('a colour beside a comment is still found', () => {
        // The blanking must not swallow the declaration next to it.
        assert.deepEqual(values('<i style="/* note */ color: #123456" />'), ['#123456']);
    });

    test('a modern colour function is a literal too', () => {
        assert.deepEqual(values('<i style="color: oklch(60% .2 20)" />'), ['oklch(60% .2 20)']);
        assert.deepEqual(values('<i style="background: lab(50% 40 59)" />'), ['lab(50% 40 59)']);
    });

    test('a named colour in any property that paints', () => {
        // The property allow-list this replaced was corrected four times —
        // `border`, `box-shadow`, `text-decoration`, then `border-block` and
        // `scrollbar-color` — because such a list cannot be finished. The
        // question is now asked the other way round: a colour keyword in a
        // value IS a colour unless the property names something.
        assert.deepEqual(values('<i style="border: 1px solid red" />'), ['1px solid red']);
        assert.deepEqual(values('<i style="box-shadow: 0 0 2px red" />'), ['0 0 2px red']);
        assert.deepEqual(values('<i style="text-decoration: underline red" />'), ['underline red']);
        assert.deepEqual(values('<i style="border-block: 1px solid red" />'), ['1px solid red']);
        assert.deepEqual(values('<i style="scrollbar-color: red blue" />'), ['red blue']);
    });

    test('a colour WORD where the property names something', () => {
        // The other side of the inversion, and the criterion the exception list
        // is derived from: the property's grammar accepts an author-chosen
        // IDENTIFIER, so the word is a name rather than paint. `list-style-type`
        // is the one review added — a counter style the author defined — and it
        // is why the comment on that list no longer claims to be closed.
        assert.deepEqual(values('<i style="grid-area: red" />'), []);
        assert.deepEqual(values(`<i style="font-family: Linen, sans-serif" />`), []);
        assert.deepEqual(values('<i style="animation: gold 1s" />'), []);
        assert.deepEqual(values('<i style="list-style-type: red" />'), []);
        assert.deepEqual(values('<i style="list-style: red inside" />'), []);
    });

    test('a custom property holding a literal is NOT excused', () => {
        // Deliberately absent from that list: `--brand: red` in a component is
        // a literal with no role behind it, and catching it is the point.
        assert.deepEqual(values('<i style="--brand: red" />'), ['red']);
    });

    test('an asset URL that spells a colour is an address', () => {
        // The stylesheet pass and this one share `URL_FRAGMENT`, and for two
        // commits they did not: this half blanked `url()` and the other did
        // not, so `background-image: url("/assets/red.svg")` would have been
        // reported there. Counter-checked against the unblanked pattern, which
        // returns the whole URL as a finding.
        assert.deepEqual(values('<i style="background-image: url(\'/assets/red.svg\')" />'), []);
    });

    test('a hyphenated identifier that begins with a colour name', () => {
        // Handled by the bounds rather than by the list: `gold-pulse` is a
        // keyframe set, and `--sa-red-500` is a token.
        assert.deepEqual(values('<i style="box-shadow: 0 0 2px var(--sa-red-500)" />'), []);
        assert.deepEqual(values('<i style="border-color: var(--sa-color-negative)" />'), []);
    });

    test('a colour function written in capitals', () => {
        // CSS function names are ASCII case-insensitive, so this is valid and
        // was invisible — the same hole `URL(#abc)` had, one pattern over.
        assert.deepEqual(values('<i style="color: OKLCH(60% .2 20)" />'), ['OKLCH(60% .2 20)']);
        assert.deepEqual(values('<i style="background: RGB(1 2 3)" />'), ['RGB(1 2 3)']);
    });

    test('a real colour beside a paint-server reference is still found', () => {
        // The blanking must not swallow the rest of the value.
        assert.deepEqual(values('<svg><rect fill="url(#abc)" stroke="#123456" /></svg>'), [
            '#123456',
        ]);
    });

    test('a word that merely contains a colour name is not one', () => {
        // The bare check matches the WHOLE value, so `redirect` and a font
        // called "Black Italic" are not findings.
        assert.deepEqual(values('<svg><path fill="redirect" stroke="blackish" /></svg>'), []);
    });

    test('a dynamic directive argument does not throw', () => {
        // `#[name]` — `prop.arg.content` is an expression, not an attribute
        // name. It must simply fail the paint-attribute test.
        assert.deepEqual(values('<template v-for="n in s" #[n]="p"><i /></template>'), []);
    });
});

describe('the other blocks belong to the other categories', () => {
    test('a <style> block is not a template finding', () => {
        // `hexColor` owns that one; counting it twice would make the two
        // numbers disagree about the same literal.
        assert.deepEqual(values('<i />', '<style>.a { color: #ff0000; }</style>'), []);
    });

    test('a <script> block is not a template finding', () => {
        assert.deepEqual(values('<i />', `<script setup>const c = '#ff0000';</script>`), []);
    });
});

describe('null and empty mean different things', () => {
    test('a file that is not an SFC is null, not empty', () => {
        assert.equal(templateColourSites('a.css', '.a { color: #fff; }'), null);
        assert.equal(templateColourSites('a.ts', "const c = '#fff';"), null);
    });

    test('an SFC with no template at all is null', () => {
        assert.equal(templateColourSites('A.vue', '<script setup>const a = 1;</script>'), null);
    });

    test('an SFC the parser cannot read is null, not empty', () => {
        // The distinction the reach counter depends on. A template the audit
        // stopped understanding must not report as a template with no
        // findings — that is the failure every counter in this audit exists to
        // make visible.
        assert.equal(templateColourSites('A.vue', '<template><div></template>'), null);
    });

    test('a template that parses and holds nothing is empty, not null', () => {
        assert.deepEqual(found('<div>hello</div>'), []);
    });
});

describe('the line is the line the literal is on', () => {
    test('a literal on the third line of the template', () => {
        const [only] = found('<i />\n<b />\n<span style="background: #ef4444" />');
        // `<template>` is line 1, so the third body line is line 4.
        assert.equal(only.line, 4);
    });

    test('a binding spread over several lines points at the literal', () => {
        // Prettier wraps a long binding, and the naive answer — the line the
        // attribute starts on — then points at an opening quote two lines above
        // the thing it is talking about.
        const [only] = found(
            `<span\n    class="x"\n    :style="{\n        background: '#ef4444',\n    }"\n/>`,
        );
        assert.equal(only.line, 5);
    });
});

// ── The rest of what an inline style says ────────────────────────────────────
//
// The group above reads a `style` attribute for COLOUR and stops there, and for
// a long time so did the audit: it walked the AST, pulled `style` out of
// `PAINT_ATTRIBUTES`, and applied nothing but the colour patterns to it. A
// `style="font-size: 22px"` was therefore invisible to `distinctFontSizes`,
// which read 0 — and `docs/design-guide.md` published that 0 as "no `font-size`
// in the package names a number". A guard satisfied exactly in the damaging
// case, with a sentence about it in the manual.
//
// `inlineStyleFragments` hands the attribute to the same declaration parser a
// `<style>` block goes through, so every category the stylesheet pass has can
// ask its question here too.

describe('the font shorthand hides three scales behind one property', () => {
    test('a size, a weight or a leading in it is a literal', () => {
        assert.equal(fontShorthandLiteral('700 40px/1 sans-serif'), '700 40px/1 sans-serif');
        assert.equal(fontShorthandLiteral('italic 13px/1.4 Inter'), 'italic 13px/1.4 Inter');
    });

    test('a tokenized shorthand is not', () => {
        assert.equal(fontShorthandLiteral('var(--sa-text-md) Inter'), null);
        assert.equal(fontShorthandLiteral('var(--sa-text-md, var(--sa-text-sm)) Inter'), null);
        assert.equal(fontShorthandLiteral('menu'), null);
    });

    test('a number in the family name is a name, not a size', () => {
        // The family is last in the shorthand, and CSS makes a numbered family
        // quote itself — so the quotes are what separate a name from a scale
        // decision. Counting it forbade adopting such a family while the type
        // size was fully tokenized.
        assert.equal(fontShorthandLiteral('var(--sa-text-md) "Source Sans 3"'), null);
        assert.equal(fontShorthandLiteral("var(--sa-text-md) 'Roboto Mono 2'"), null);
        // And a real size still counts, however the family is written.
        assert.equal(fontShorthandLiteral('13px "Source Sans 3"'), '13px "Source Sans 3"');
    });
});

describe('an inline style is a stylesheet fragment', () => {
    test('a static style attribute is a fragment', () => {
        assert.deepEqual(fragments('<span style="font-size: 22px" />'), [
            { text: 'font-size: 22px', line: 2 },
        ]);
    });

    test('several attributes, in template order', () => {
        assert.deepEqual(
            fragments('<i style="margin-top: 6px" />\n<b style="max-width: 120px" />').map(
                (f) => f.text,
            ),
            ['margin-top: 6px', 'max-width: 120px'],
        );
    });

    test('a bound :style is NOT a fragment', () => {
        // Deliberate, and the reason is the property. A bound value is
        // JavaScript: keys are camelCase and separators are commas, so a CSS
        // declaration parser reading `{ minWidth: '200px', marginTop: '8px' }`
        // hands both values to `min-width` and files a spacing literal as a
        // dimension. `templateColourSites` can read a bound binding because a
        // colour literal is the same string in either language and needs no
        // property; a length needs one.
        assert.deepEqual(fragments(`<i :style="{ marginTop: '8px' }" />`), []);
    });

    test('an attribute that is not `style` is not a fragment', () => {
        assert.deepEqual(fragments('<q-icon size="18px" name="x" />'), []);
    });

    test('null and empty still mean different things', () => {
        assert.equal(inlineStyleFragments('a.css', '.a { color: #fff; }'), null);
        assert.equal(inlineStyleFragments('A.vue', '<template><div></template>'), null);
        assert.deepEqual(fragments('<div>hello</div>'), []);
    });

    test('a bound style that is one string literal is inline CSS too', () => {
        // `:style="'font-size: 22px'"` is applied verbatim by Vue. It is bound,
        // so a filter on `isStatic` dropped it and every budget stayed green
        // for a declaration that really renders.
        assert.deepEqual(fragments(`<span :style="'font-size: 22px'">a</span>`), [
            { text: 'font-size: 22px', line: 2 },
        ]);
        // The object form is JavaScript — `fontSize` is not a CSS property and
        // its value may be an expression — so it stays with the colour reader,
        // which knows how to pick literals out of it.
        assert.deepEqual(fragments(`<span :style="{ fontSize: size }">a</span>`), []);
        // A template literal that interpolates says nothing knowable here.
        assert.deepEqual(fragments('<span :style="`width: ${w}px`">a</span>'), []);
    });

    test('the line is the line the attribute value starts on', () => {
        assert.deepEqual(fragments('<i />\n<b />\n<span style="font-size: 22px" />'), [
            { text: 'font-size: 22px', line: 4 },
        ]);
    });
});

// ── The colour decision that is a class name ─────────────────────────────────
//
// A colour written with no colour in it: `class="text-grey-7"` contains no hex,
// no colour function and no CSS keyword, so none of the patterns above can see
// one. It resolves to Quasar's palette, one layer BELOW the role tokens and
// outside the theme — so the caption keeps its grey when the dark theme moves
// the surface under it, and the template gives no sign.
//
// A template writes that decision in two syntaxes; the group after this one is
// the other.

describe('a Quasar palette class is a colour decision', () => {
    test('a static class list', () => {
        assert.deepEqual(classes('<span class="row text-grey-7" />'), ['text-grey-7']);
    });

    test('a bound class list holds its literals as strings', () => {
        assert.deepEqual(classes(`<span :class="['chip', ok ? 'bg-warning' : '']" />`), [
            'bg-warning',
        ]);
    });

    test('a brand or status name, not only a palette hue', () => {
        assert.deepEqual(classes('<div class="bg-negative text-white" />'), [
            'bg-negative',
            'text-white',
        ]);
    });

    test('a two-word hue is read whole', () => {
        // The alternation lists `blue` and `grey` before `blue-grey`, so this
        // only works because each match must end on a boundary that is not `-`.
        // Read as `text-blue` the finding would name a class that does not
        // exist, and `deep-orange`, `light-green` and `dark-page` have the same
        // shape.
        assert.deepEqual(classes('<div class="text-blue-grey-7 bg-deep-orange" />'), [
            'text-blue-grey-7',
            'bg-deep-orange',
        ]);
    });

    test('a string the list COMPARES is not a class it renders', () => {
        // `tone === 'text-grey-7' ? 'muted' : ''` renders `muted`. The
        // class-shaped string is data being tested, and counting it made an
        // unrelated state comparison a palette decision the ratchet can fail
        // on. The operator is what says so, on either side of it.
        assert.deepEqual(classes(`<span :class="tone === 'text-grey-7' ? 'muted' : ''" />`), []);
        assert.deepEqual(classes(`<span :class="'text-grey-7' === tone ? 'muted' : ''" />`), []);
        assert.deepEqual(classes(`<span :class="tone !== 'bg-warning' ? 'muted' : ''" />`), []);
        assert.deepEqual(classes(`<span :class="{ muted: tone == 'text-red-5' }" />`), []);
    });

    test('and grouping around the operand does not save it', () => {
        // The same comparison with parentheses. A pattern that demanded the
        // quote touch the operator counted the operand anyway — the false
        // positive this helper removes, one character further out.
        assert.deepEqual(
            classes(`<span :class="tone === ('text-grey-7') ? 'muted' : ''">a</span>`),
            [],
        );
        assert.deepEqual(props(`<q-icon :color="('dark') === mode ? 'accent' : 'accent'" />`), [
            'accent',
            'accent',
        ]);
    });

    test('the branch a comparison SELECTS is still a class', () => {
        // The direction that matters more, because it is the one a hole would
        // open: only the operand is dropped, so a palette class chosen by the
        // comparison is counted exactly as before. Both operand shapes, so a
        // wider blanking pass cannot satisfy this by accident.
        assert.deepEqual(classes(`<span :class="mode === 'dark' ? 'text-grey-7' : ''" />`), [
            'text-grey-7',
        ]);
        assert.deepEqual(classes(`<span :class="{ 'bg-warning': tone === 'muted' }" />`), [
            'bg-warning',
        ]);
        // And an equality operand is the ONLY string dropped: a class list is
        // read for its literals everywhere else in the same expression.
        assert.deepEqual(
            classes(`<span :class="[tone === 'x' ? 'text-positive' : '', 'bg-negative']" />`),
            ['text-positive', 'bg-negative'],
        );
    });

    test('a class that merely ends in a palette word is not one', () => {
        // `sa-text-red` is this package's own naming, and a utility class is
        // not a colour: `text-center` and `text-bold` are layout and weight.
        assert.deepEqual(
            classes('<div class="sa-text-red text-center text-bold my-bg-grey" />'),
            [],
        );
    });

    test('a rule ABOUT the class is not a use of it', () => {
        // Read from `class` attributes only. A `.text-grey-7 { … }` selector in
        // a `<style>` block is the package defining or overriding the class,
        // which is a different act from a page choosing it.
        assert.deepEqual(classes('<i />', '<style>.text-grey-7 { color: red; }</style>'), []);
    });

    test('blanking a compared string does not move the line after it', () => {
        // Every pre-pass in the scanner blanks rather than removes, because the
        // line a finding reports is an offset into the blanked text. Prettier
        // wraps a long binding, so the operand and the class it selects
        // routinely sit on different lines.
        const [only] = templateColourClasses(
            'A.vue',
            sfc(
                `<span\n    :class="\n        tone === 'text-grey-7'\n            ? 'bg-warning'\n            : ''\n    "\n/>`,
            ),
        );
        assert.deepEqual(only, { line: 5, value: 'bg-warning' });
    });

    test('null and empty still mean different things', () => {
        assert.equal(templateColourClasses('a.ts', "const c = 'text-grey-7';"), null);
        assert.equal(templateColourClasses('A.vue', '<template><div></template>'), null);
        assert.deepEqual(classes('<div class="row" />'), []);
    });
});

// ── The same decision, written as a prop ─────────────────────────────────────
//
// The group above was introduced as "the one place no pattern could see", and
// that was false one attribute over: `<q-icon color="grey-7">` renders
// `class="text-grey-7"` — literally what `templateColourClasses` counts — so
// the class form was debt and the thing that COMPILES to it was free. Two
// syntaxes, one palette, and a metric that reads one of them ends the search
// just as convincingly as a metric that reads neither.

describe('a Quasar palette prop is the same colour decision', () => {
    test('a static prop', () => {
        assert.deepEqual(props('<q-icon color="grey-7" />'), ['grey-7']);
    });

    test('the two halves a component paints', () => {
        assert.deepEqual(props('<q-badge color="grey-5" text-color="grey-9" />'), [
            'grey-5',
            'grey-9',
        ]);
    });

    test('a brand or status name, not only a hue', () => {
        // Counted like the class form counts `bg-negative`. Whether these may
        // stay is a decision about the component layer; the number is what puts
        // it in front of a person.
        assert.deepEqual(props('<q-btn color="primary" /><q-icon color="negative" />'), [
            'primary',
            'negative',
        ]);
    });

    test('a bound prop holds its literals as strings', () => {
        // The package already writes plenty of them this way. Reading only the
        // static half would put the hole exactly where a contributor routes
        // around the ratchet: rewrite `color="negative"` as this, and the
        // number falls with nothing changed.
        assert.deepEqual(props(`<q-btn :color="isRegression ? 'negative' : 'positive'" />`), [
            'negative',
            'positive',
        ]);
        assert.deepEqual(props(`<q-btn :color="action.color ?? 'grey-7'" />`), ['grey-7']);
    });

    test('a string the binding COMPARES is not a palette name it emits', () => {
        // The same over-read one attribute over, and it was disclosed rather
        // than fixed: `dark` is a palette name as well as a theme, so this
        // counted three where two were written. Narrowed by the operator, not
        // by a list of the strings that cannot reach a value.
        assert.deepEqual(props(`<q-btn :color="mode === 'dark' ? 'negative' : 'primary'" />`), [
            'negative',
            'primary',
        ]);
        assert.deepEqual(props(`<q-btn :color="mode === 'dark' ? tone : fallback" />`), []);
    });

    test('a binding that names nothing is not a finding', () => {
        // The counter-check in the other direction, and the one the whole
        // static/bound split has to survive: the colour lives in a script,
        // where no template pass can reach it, and guessing would be worse than
        // missing it.
        assert.deepEqual(props('<q-btn :color="x" />'), []);
        assert.deepEqual(props('<q-badge :color="statusColor(row.status)" />'), []);
    });

    test('a nested object is configuration, not props', () => {
        // Vue binds the outer key. `v-bind="{ options: { color: 'primary' } }"`
        // emits `options`, not `color`, and a pattern that resumed at every `{`
        // read the inner one as a prop — a nested `class` or `style` fed the
        // other two ratchets the same way.
        assert.deepEqual(props(`<q-icon v-bind="{ options: { color: 'primary' } }" />`), []);
        assert.deepEqual(classes(`<span v-bind="{ cfg: { class: 'text-grey-7' } }">a</span>`), []);
        // A top-level entry beside a nested one is still read.
        assert.deepEqual(
            props(`<q-icon v-bind="{ color: 'grey-7', cfg: { color: 'primary' } }" />`),
            ['grey-7'],
        );
    });

    test('every prop that ends in -color on a Quasar component is one', () => {
        // Quasar's convention, not a list of three: QStepper alone adds
        // `active-color`, `done-color`, `error-color` and `inactive-color`, and
        // `PlanChangeWizard.vue` writes the first of them — uncounted until now,
        // so the ratchet held room it was never granted.
        assert.deepEqual(props('<q-stepper active-color="primary" done-color="positive" />'), [
            'primary',
            'positive',
        ]);
        assert.deepEqual(props('<q-tabs indicator-color="accent" />'), ['accent']);
        // The tag still decides — someone else's `-color` prop is not Quasar's
        // palette, whatever it is called.
        assert.deepEqual(props('<my-thing status-color="primary" />'), []);
        // And a value outside the palette is not a palette decision either.
        assert.deepEqual(props('<q-stepper active-color="ink" />'), []);
    });

    test('the object form of v-bind is read like the arg form', () => {
        // `v-bind="{ color: 'grey-7' }"` has no arg, so a reader that requires
        // one discarded the whole binding while Vue emitted the prop — the same
        // decision written the other way, and it walked past every metric.
        assert.deepEqual(props(`<q-icon v-bind="{ color: 'grey-7' }" />`), ['grey-7']);
        // The tag still decides: an unrelated component's own prop is not a
        // Quasar palette dependency, whichever syntax carries it.
        assert.deepEqual(props(`<my-chart v-bind="{ color: 'primary' }" />`), []);
        // And a key whose value is an expression names no colour here.
        assert.deepEqual(props(`<q-icon v-bind="{ color: tone }" />`), []);
    });

    test('a value outside the palette is not a palette finding', () => {
        // `color="#fff"` on a component paints nothing — Quasar turns it into a
        // `text-#fff` class — so it is a bug for a different check, not a
        // palette decision. `color="ink"` is somebody's own prop.
        assert.deepEqual(props('<q-icon color="#fff" /><my-thing color="ink" />'), []);
    });

    test('a two-word hue is read whole, with its shade', () => {
        // The alternation lists `blue` and `grey` before `blue-grey`, so this
        // only works because the pattern is anchored — on the value's end for a
        // static attribute, on the closing quote for a bound one.
        assert.deepEqual(props('<q-icon color="blue-grey-7" bg-color="deep-orange" />'), [
            'blue-grey-7',
            'deep-orange',
        ]);
        assert.deepEqual(props(`<q-icon :color="'blue-grey-7'" />`), ['blue-grey-7']);
    });

    test('a value that merely begins with a palette word is not one', () => {
        assert.deepEqual(props('<q-icon color="greyish" /><q-btn color="primary-cta" />'), []);
    });

    test('an attribute that is not a colour prop is not read', () => {
        assert.deepEqual(props('<q-icon name="primary" size="18px" />'), []);
    });

    test('`color` inside SVG belongs to the paint category', () => {
        // The same split `templateColourSites` makes, from the other side: in
        // the SVG namespace `color` is real paint and that pass owns it, so
        // reading it here too would count one decision under two metrics.
        assert.deepEqual(props('<svg color="white"><path fill="currentColor" /></svg>'), []);
        assert.deepEqual(values('<svg color="white"><path fill="currentColor" /></svg>'), [
            'white',
        ]);
    });

    test('the class form belongs to the class category', () => {
        assert.deepEqual(props('<span class="text-grey-7" />'), []);
    });

    test('a comment in a binding is prose, not a palette', () => {
        assert.deepEqual(props(`<q-btn :color="/* was 'negative' */ tone" />`), []);
        assert.deepEqual(props(`<q-btn :color="\n  // was 'negative'\n  tone\n" />`), []);
    });

    test('null and empty still mean different things', () => {
        assert.equal(templatePaletteProps('a.ts', "const c = 'grey-7';"), null);
        assert.equal(templatePaletteProps('A.vue', '<template><div></template>'), null);
        assert.deepEqual(props('<q-btn label="x" />'), []);
    });

    test('the line is the line the value sits on', () => {
        const [only] = templatePaletteProps(
            'A.vue',
            sfc('<i />\n<b />\n<q-icon color="grey-7" />'),
        );
        assert.equal(only.line, 4);
    });
});
