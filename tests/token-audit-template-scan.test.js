import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { templateColourSites } from '../scripts/token-audit.mjs';

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
        // The other side of the inversion, and the reason the old list existed:
        // these are identifiers an author chose, not paint.
        assert.deepEqual(values('<i style="grid-area: red" />'), []);
        assert.deepEqual(values(`<i style="font-family: Linen, sans-serif" />`), []);
        assert.deepEqual(values('<i style="animation: gold 1s" />'), []);
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
