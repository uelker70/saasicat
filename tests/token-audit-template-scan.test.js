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
        // Documented, not accidental: `color` is absent from the paint list
        // because `color="primary"` is Quasar's vocabulary. The cost is that a
        // hex written there is invisible here — but a hex written there does
        // not paint anything either, since Quasar turns it into a `text-#fff`
        // class. It is a bug for a different check.
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
