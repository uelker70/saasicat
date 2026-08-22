import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'vue/compiler-sfc';

// Every standard page sits inside the theme's reach.
//
// The component layer corrects Quasar's own DOM — the outlined control's
// transparent background, the 4px radii, the #1d1d1d card that Quasar paints in
// dark mode — and it can only do that through a class it finds ABOVE the
// element it is correcting. There are two such classes, and a screen that
// carries neither gets Quasar's look with none of the corrections.
//
// Nothing announces that. The screen renders, the colours come from the token
// layer through inheritance, and only a side-by-side comparison with a page
// that IS in reach shows the difference. The login screen, the setup wizard and
// the manifest-error page shipped that way — the three screens a user sees
// before and instead of the admin shell, which is the worst possible set to
// have missed.
//
// The markers are DERIVED from the stylesheets rather than listed here, because
// a list is the same defect one level up: it would be right on the day it was
// written and silently incomplete afterwards.

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const THEME_COMPONENTS = join(SRC, 'ui', 'theme', 'components');
const PAGES = join(SRC, 'pages');
// The shell and the two auth screens left `pages/` in the 4.1 move but are
// still pages in every sense the theme cares about.
const PAGE_DIRS = [PAGES, join(SRC, 'layouts'), join(SRC, 'auth')];

/**
 * CSS comments only. There is no HTML comment handling here any more, and that
 * is the point: `parse()` below hands back a template whose comment nodes are
 * their own node type, so commented-out markup never reaches the class scan.
 *
 * The hand-written version was wrong three times over — it missed `--!>` as a
 * comment ending, and stripping one delimiter could join its neighbours into a
 * new one. Each fix revealed the next case, which is the signal to stop writing
 * a parser and use the one that ships with the framework whose files these are.
 */
const withoutCssComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every selector in a stylesheet, one per comma-separated part. */
function selectorParts(css) {
    return [...withoutCssComments(css).matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap(([, selector]) =>
        selector.split(',').map((part) => part.trim().replace(/\s+/g, ' ')),
    );
}

/**
 * The classes through which the theme reaches DOM it does not render.
 *
 * A reach marker is a class the component layer only ever uses as a PREFIX in
 * front of a Quasar class and never styles itself. That is what tells the two
 * kinds apart: `.sa-icon-btn .q-icon` prefixes a Quasar class too, but
 * `.sa-icon-btn` is a button this package renders and styles — it is a
 * component, not a root it expects to find above it.
 */
function reachMarkers() {
    const parts = readdirSync(THEME_COMPONENTS)
        .filter((name) => name.endsWith('.css'))
        .flatMap((name) => selectorParts(readFileSync(join(THEME_COMPONENTS, name), 'utf8')));

    const styledOnTheirOwn = new Set(
        parts.filter((part) => /^\.sa-[\w-]+$/.test(part)).map((part) => part.slice(1)),
    );
    const prefixes = new Set();
    for (const part of parts) {
        const descendant = part.match(/^\.(sa-[\w-]+) (.+)$/);
        if (descendant && /\.q-/.test(descendant[2])) prefixes.add(descendant[1]);
    }
    return new Set([...prefixes].filter((name) => !styledOnTheirOwn.has(name)));
}

/**
 * Root elements of an SFC's template, from the compiler's own AST.
 *
 * A `v-if` / `v-else` pair is two roots, which is why this returns a list.
 *
 * Parsed rather than matched. The hand-written version needed a tag pattern
 * that consumed quoted runs whole (an attribute here contains `=>` often
 * enough), a void-element list, and a depth counter — and it still mis-read
 * `</template >`, treated `--!>` as ordinary text, and could turn `<<!--!--`
 * into a live `<!--`. Three fixes, three new cases. The framework whose files
 * these are ships the parser; there is no reason to keep a second one.
 */
function rootElements(source) {
    const { descriptor, errors } = parse(source, { ignoreEmpty: false });
    if (errors.length > 0 || !descriptor.template?.ast) return null;
    // NodeTypes.ELEMENT === 1. A comment is its own node type, so commented-out
    // markup is skipped here without any stripping — which is the whole reason
    // this reads an AST.
    return descriptor.template.ast.children.filter((node) => node.type === 1);
}

/**
 * Class names an element carries, static and bound.
 *
 * The bound form is split on the punctuation of an object or array literal, so
 * `:class="{ 'sa-page': ready }"` yields `sa-page` — a marker applied
 * conditionally still counts, because the alternative is a guard that a page
 * can fail by writing the same thing a different way.
 */
function classNames(node) {
    const names = new Set();
    for (const prop of node.props ?? []) {
        // ATTRIBUTE === 6
        if (prop.type === 6 && prop.name === 'class' && prop.value?.content) {
            for (const name of prop.value.content.split(/\s+/)) if (name) names.add(name);
        }
        // DIRECTIVE === 7; `:class` is v-bind with `class` as its argument.
        if (prop.type === 7 && prop.name === 'bind' && prop.arg?.content === 'class' && prop.exp) {
            for (const name of prop.exp.content.split(/[\s'"[\]{},:?()!&|]+/)) {
                if (name) names.add(name);
            }
        }
    }
    return names;
}

const pascal = (tag) => tag.replace(/(^|-)(\w)/g, (_, __, letter) => letter.toUpperCase());

/** Local `.vue` imports of an SFC, by the tag name they are used under. */
function componentImports(file, source) {
    const map = new Map();
    for (const [, name, path] of source.matchAll(/import\s+(\w+)\s+from\s+'([^']+\.vue)'/g)) {
        map.set(name, resolve(dirname(file), path));
    }
    return map;
}

/**
 * Does this component render a node inside the theme's reach?
 *
 * A page's own root is usually a component — `AdminPage` is what carries
 * `.sa-page` for sixteen of them — so a marker on the root of what the root
 * renders counts. `resolved` records that this happened at least once, because
 * a resolver that silently stopped resolving would let the whole suite pass by
 * finding nothing to check.
 */
function reachesTheTheme(file, markers, resolved, seen = new Set()) {
    if (seen.has(file)) return false;
    seen.add(file);

    const source = readFileSync(file, 'utf8');
    const roots = rootElements(source);
    if (!roots || roots.length === 0) return false;
    const imports = componentImports(file, source);

    return roots.every((root) => {
        if ([...classNames(root)].some((name) => markers.has(name))) return true;
        const child = imports.get(pascal(root.tag));
        if (!child) return false;
        resolved.add(`${relative(SRC, file)} → ${relative(SRC, child)}`);
        return reachesTheTheme(child, markers, resolved, seen);
    });
}

describe('the theme reaches every page it ships', () => {
    const markers = reachMarkers();

    test('the reach markers are derivable from the stylesheets', () => {
        assert.ok(
            markers.size >= 2,
            `only ${markers.size} reach markers derived — the rule below would pass vacuously`,
        );
        // A marker nobody renders is a name this test invented. Each one has to
        // appear in the package's own source, or the derivation is wrong.
        for (const marker of markers) {
            const rendered = readdirSync(SRC, { recursive: true, withFileTypes: true })
                .filter((entry) => entry.isFile() && /\.(vue|ts)$/.test(entry.name))
                .some((entry) =>
                    readFileSync(join(entry.parentPath, entry.name), 'utf8').includes(marker),
                );
            assert.ok(rendered, `no file in src renders "${marker}" — is it a marker at all?`);
        }
    });

    test('a marker that exists only inside a comment does not count', () => {
        // The property three hand-written stripper fixes were chasing. It is
        // free now — a comment is its own node type and `rootElements` keeps
        // only elements — but asserted so it cannot regress silently if the
        // parsing changes again.
        //
        // The two comment endings reach it differently, and both are recorded
        // because the difference is the interesting part:
        const closed = rootElements(
            '<template>\n  <!-- <div class="sa-page"> -->\n  <div class="thing" />\n</template>\n',
        );
        assert.equal(closed.length, 1, 'the commented-out element was read as an element');
        assert.equal(closed[0].tag, 'div');
        assert.equal(classNames(closed[0]).has('sa-page'), false);

        // `--!>` is NOT a comment ending to Vue's parser — it reports
        // "Unexpected EOF in comment" and swallows the rest. `rootElements`
        // answers null for a file it cannot parse, and `reachesTheTheme` turns
        // that into a failure rather than a pass. Either way the marker cannot
        // leak, which is what this case is really about.
        assert.equal(
            rootElements(
                '<template>\n  <!-- <div class="sa-page"> --!>\n  <div class="thing" />\n</template>\n',
            ),
            null,
        );

        // And an uncommented marker still counts, or both cases above would
        // pass on a parser that returned nothing for everything.
        const live = rootElements('<template>\n  <div class="sa-page" />\n</template>\n');
        assert.equal(classNames(live[0]).has('sa-page'), true);
    });

    test('every standard page renders a node inside that reach', () => {
        const files = PAGE_DIRS.flatMap((dir) =>
            readdirSync(dir)
                .filter((name) => name.endsWith('.vue'))
                .map((name) => join(dir, name)),
        );

        // The shell is not a page. It renders Quasar's own layout, and the
        // theme paints it through `.sa-admin-layout` in base.css instead — so
        // asking it for a page marker would be asking the wrong question.
        const layouts = files.filter((file) => /<q-layout[\s>]/.test(readFileSync(file, 'utf8')));
        assert.equal(
            layouts.length,
            1,
            `${layouts.length} files render a Quasar layout; the exemption assumes exactly one`,
        );

        // Child routes are not exempt — they are covered by their PARENT.
        //
        // The plan editor and review render inside `<router-view />` in
        // `PlansPage`, which carries `sa-page`; asking them for a marker of
        // their own would ask for a second page frame inside the first. The
        // nesting is read off `STANDARD_ADMIN_ROUTES`, not listed here, so a
        // page that stops being a child stops being exempt on the same day.
        // Read out of the route table's source rather than imported: this file
        // is plain JS under `node --test`, and `pages/index.ts` ships as source
        // rather than through `dist`. Reading it still derives the answer from
        // the one place that declares it.
        const routeTable = readFileSync(join(SRC, 'pages', 'index.ts'), 'utf8');
        const childBlocks = routeTable.match(/children:\s*\[[\s\S]*?\]/g) ?? [];
        const nested = new Set(
            childBlocks
                .flatMap((block) => [...block.matchAll(/page:\s*'(\w+)'/g)])
                .map((match) => `${match[1]}.vue`),
        );
        assert.ok(
            nested.size > 0,
            'no nested routes found — either the route table changed shape or this exemption ' +
                'lost its subject, and a real offender would now pass as a child of nothing',
        );

        const pages = files.filter(
            (file) => !layouts.includes(file) && !nested.has(basename(file)),
        );
        assert.ok(pages.length >= 15, `only ${pages.length} pages found — the roster moved`);

        const resolved = new Set();
        const offenders = pages
            .filter((file) => !reachesTheTheme(file, markers, resolved))
            .map((file) => relative(SRC, file));

        assert.ok(
            resolved.size > 0,
            'no page root resolved through a child component — the resolver stopped working, ' +
                'and every page that gets its marker from AdminPage is now unchecked',
        );
        assert.deepEqual(
            offenders,
            [],
            `a page root carries none of the theme's reach markers (${[...markers].join(', ')}). ` +
                'Everything the component layer corrects on Quasar — the outlined field, the ' +
                'card surface, the table, the menu — hangs off one of those classes, so without ' +
                'one the page renders in Quasar’s own look and nothing reports it.',
        );
    });
});
