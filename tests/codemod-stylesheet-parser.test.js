import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    colourSites,
    declarations,
    normaliseColour,
    propertyGroup,
    siteKey,
    styleBlocks,
} from '../scripts/codemods/lib/stylesheets.mjs';

// The parser that decides what a codemod is allowed to rewrite, under test for
// the first time.
//
// It drove an 841-literal colour migration without one, and the cost of that
// surfaced only in review: `declarations('.a { /* n */ color: red; }')` returned
// nothing, because the chunk still carried the comment and a property with a
// space in it is rejected as a selector. Nobody noticed, because the audit that
// reports the numbers uses its own regexes over the raw text — so the count
// stayed honest while the rewriter went blind. A silent under-reach in a tool
// whose whole job is "find every site" is the worst shape a bug can have here:
// it looks like a finished migration.
//
// Two properties are load-bearing and each has its own group below:
//
//   1. Every span this module reports is a byte range in the ORIGINAL text.
//      The codemods patch by index; an index that is off by the length of a
//      comment lands in the middle of a neighbouring value.
//   2. A colour's role comes from its property, never from its value.

describe('declarations — comments sit wherever a space may sit', () => {
    // The reported case. Before the fix this returned [].
    test('a comment before the property does not hide the declaration', () => {
        assert.deepEqual(
            declarations('.a { /* n */ color: #ff0000; }').map((d) => d.property),
            ['color'],
        );
    });

    test('a comment between two declarations hides neither', () => {
        assert.deepEqual(
            declarations('.a { color: #f00; /* n */ background: #0f0; }').map((d) => d.property),
            ['color', 'background'],
        );
    });

    test('a comment glued to the property name is still a comment', () => {
        assert.deepEqual(
            declarations('.a { color/* x */: red; }').map((d) => d.property),
            ['color'],
        );
    });

    test('a commented-out rule contributes no declarations', () => {
        assert.deepEqual(
            declarations('/* .b { color: #123456; } */ .a { color: #ff0000; }').map(
                (d) => d.property,
            ),
            ['color'],
        );
    });

    test('an unterminated comment swallows the rest and nothing more', () => {
        assert.deepEqual(declarations('.a { color: red; } .b { /* on and on'), [
            { property: 'color', value: ' red', valueStart: 11, valueEnd: 15 },
        ]);
    });

    // Each can appear inside the other, so they have to be recognised together.
    test('a comment opener inside a string opens no comment', () => {
        assert.deepEqual(
            declarations('.a { content: "/*"; color: #ff0000; }').map((d) => d.property),
            ['content', 'color'],
        );
    });

    test('an apostrophe inside a comment opens no string', () => {
        assert.deepEqual(
            declarations(".a { /* don't */ color: #ff0000; }").map((d) => d.property),
            ['color'],
        );
    });
});

describe('declarations — the span is a byte range in the original text', () => {
    // The property this module exists for. If it breaks, a codemod writes its
    // replacement over whatever happens to sit at the shifted offset.
    const patchable = (css) => {
        const found = declarations(css);
        return found.map((d) => css.slice(d.valueStart, d.valueEnd));
    };

    test('offsets survive a comment before the declaration', () => {
        assert.deepEqual(patchable('.a { /* n */ color: #ff0000; }'), [' #ff0000']);
    });

    test('offsets survive a comment inside the value', () => {
        assert.deepEqual(patchable('.a { color: /* was #000 */ #ff0000; }'), [
            ' /* was #000 */ #ff0000',
        ]);
    });

    test('offsets survive a multi-line comment', () => {
        const css = '.a {\n  /* two\n     lines */\n  color: #ff0000;\n}';
        assert.deepEqual(patchable(css), [' #ff0000']);
    });
});

describe('declarations — structure', () => {
    test('a selector colon is not a property', () => {
        assert.deepEqual(
            declarations('a:hover { color: red; }\n.b::before { content: ""; }').map(
                (d) => d.property,
            ),
            ['color', 'content'],
        );
    });

    test('a colon inside parentheses does not split the property', () => {
        const [only] = declarations('.a { background: var(--x, url(data:image/png,z)); }');
        assert.equal(only.property, 'background');
        assert.equal(only.value.trim(), 'var(--x, url(data:image/png,z))');
    });

    test('the last declaration needs no trailing semicolon', () => {
        assert.deepEqual(
            declarations('.a { color: red }').map((d) => d.property),
            ['color'],
        );
    });

    test('nesting needs no special case — @media and :deep() are just depth', () => {
        assert.deepEqual(
            declarations('@media (min-width: 600px) { .a { color: red; } }\n:deep(.b) { top: 0; }')
                .map((d) => d.property)
                .sort(),
            ['color', 'top'],
        );
    });

    test('a custom property is a declaration like any other', () => {
        assert.deepEqual(
            declarations('.a { --sa-x: 4px; }').map((d) => d.property),
            ['--sa-x'],
        );
    });
});

describe('propertyGroup — the paint job, not the value', () => {
    // The rule the whole colour map is keyed on: `#fff` is a surface under
    // `background` and a foreground under `color`.
    test('the same literal lands in different groups', () => {
        assert.equal(propertyGroup('color'), 'text');
        assert.equal(propertyGroup('background'), 'surface');
        assert.equal(propertyGroup('border-top-color'), 'border');
        assert.equal(propertyGroup('box-shadow'), 'shadow');
        assert.equal(propertyGroup('fill'), 'icon');
    });

    test('a custom property is its own group — its readers decide its role', () => {
        assert.equal(propertyGroup('--sa-anything'), 'custom');
    });

    test('a property that paints nothing is not a colour site', () => {
        assert.equal(propertyGroup('padding'), 'other');
        assert.equal(propertyGroup('grid-template-columns'), 'other');
    });

    test('case and padding do not change the group', () => {
        assert.equal(propertyGroup('  BACKGROUND-COLOR  '), 'surface');
    });
});

describe('styleBlocks — only stylesheets, with their offset', () => {
    test('a .css file is one block at offset 0', () => {
        assert.deepEqual(styleBlocks('a.css', '.a { color: red; }'), [
            { text: '.a { color: red; }', offset: 0 },
        ]);
    });

    test('an SFC contributes one block per <style>, offset into the file', () => {
        const sfc = '<template><b>#fff</b></template>\n<style>.a { color: red; }</style>';
        const [block] = styleBlocks('A.vue', sfc);
        assert.equal(block.text, '.a { color: red; }');
        assert.equal(sfc.slice(block.offset, block.offset + block.text.length), block.text);
    });

    test('an upper-case tag is still a block', () => {
        // Vue writes `<style>` lowercase and so does every file here, but a
        // case-sensitive pattern fails SILENTLY on one that is not: no block,
        // no declarations, no findings — a file that reads as clean because it
        // was never read. The audit and this parser both carried that, and the
        // audit is what reports "0 hard-coded colours".
        assert.equal(styleBlocks('A.vue', '<STYLE>.a{color:red}</STYLE>').length, 1);
        assert.equal(
            styleBlocks('A.vue', '<Style scoped>.a{color:red}</Style>')[0].text,
            '.a{color:red}',
        );
    });

    test('an end tag is read however HTML lets it be written', () => {
        // An end tag is `</name`, anything that is not `>`, then `>` — a space,
        // a newline, even attributes, which the HTML parser ignores. The
        // pattern used to demand `</style>` exactly, and a pattern that cannot
        // match a tag does not fail: it returns NO BLOCK, so the file reads as
        // having no styles at all. Silent under-reach, in the parser that
        // decides what a codemod may rewrite.
        for (const form of [
            '</style>',
            '</style >',
            '</style\n>',
            '</style\t\n bar>',
            '</STYLE>',
        ]) {
            const blocks = styleBlocks('A.vue', `<style>.a{top:0}${form}`);
            assert.equal(blocks.length, 1, `${JSON.stringify(form)} was not read as an end tag`);
            assert.equal(blocks[0].text, '.a{top:0}');
        }
    });

    test('scoped and lang attributes do not hide a block', () => {
        assert.equal(styleBlocks('A.vue', '<style scoped lang="scss">.a{top:0}</style>').length, 1);
    });
});

describe('colourSites — what a codemod is handed', () => {
    const sfc = [
        '<template>',
        '  <div style="color: #123456">#abcdef</div>',
        '</template>',
        '<style scoped>',
        '.a { color: #fff; background: #fff; }',
        '</style>',
    ].join('\n');

    test('a template is never a site — neither its text nor its inline style', () => {
        assert.deepEqual(
            colourSites('A.vue', sfc).map((s) => s.value),
            ['#fff', '#fff'],
        );
    });

    test('start/end address the literal in the original file', () => {
        for (const site of colourSites('A.vue', sfc)) {
            assert.equal(sfc.slice(site.start, site.end), site.raw);
        }
    });

    test('the same literal under two properties yields two different keys', () => {
        assert.deepEqual(colourSites('A.vue', sfc).map(siteKey), ['text #fff', 'surface #fff']);
    });

    test('a colour inside a comment is prose, not paint', () => {
        assert.deepEqual(colourSites('a.css', '.a { /* #000000 */ color: #ff0000; }'), [
            {
                property: 'color',
                group: 'text',
                value: '#ff0000',
                raw: '#ff0000',
                start: 26,
                end: 33,
                line: 1,
            },
        ]);
    });

    test('a functional colour with a var() channel is a token in use, not a literal', () => {
        // The migration's own output must not read as new debt.
        assert.deepEqual(
            colourSites('a.css', '.a { box-shadow: 0 1px rgb(var(--sa-shadow-ink) / 6%); }'),
            [],
        );
    });

    test('sites come back in document order', () => {
        const sites = colourSites(
            'a.css',
            '.a { color: #111; } .b { color: #222; } .c { color: #333; }',
        );
        assert.deepEqual(
            sites.map((s) => s.value),
            ['#111', '#222', '#333'],
        );
    });
});

describe('normaliseColour — one key per colour', () => {
    test('case and inner whitespace do not make a second key', () => {
        assert.equal(normaliseColour('#FFF'), '#fff');
        assert.equal(normaliseColour('rgba(0, 0, 0, .5)'), 'rgba(0,0,0,.5)');
    });
});
