import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
const PAGES = join(SRC, 'pages-standard');

/**
 * Source with its comments removed, so commented-out markup is not read as
 * markup.
 *
 * The HTML pass repeats until it stops changing, and then drops any orphaned
 * delimiter. One pass is not enough: `<!<!-- -->--` leaves a bare `<!--`
 * behind, and for this file the consequence is not cosmetic — a leftover
 * delimiter means commented-out markup gets scanned for reach markers, so a
 * page could PASS on a marker it only carries inside a comment. Erring toward
 * removing too much is the safe direction here; erring toward keeping it is
 * how a guard reports success it did not verify.
 */
const withoutComments = (source) => {
    let text = source.replace(/\/\*[\s\S]*?\*\//g, '');
    let previous;
    do {
        previous = text;
        // Both end forms. HTML closes a comment with `-->` OR `--!>`, and
        // matching only the first let a commented-out `class="sa-page"` through
        // — the guard would then pass on a marker that exists only in a comment.
        text = text.replace(/<!--[\s\S]*?(?:--!?>)/g, '');
        // Looped for the same reason as above, and for one more: removing a
        // delimiter can JOIN its neighbours into a new one — `<<!--!--` becomes
        // `<!--` after a single pass. Repeating until nothing changes is what
        // makes "contains no delimiter" true rather than probable.
        text = text.replace(/<!--|--!?>/g, '');
    } while (text !== previous);
    return text;
};

/** Every selector in a stylesheet, one per comma-separated part. */
function selectorParts(css) {
    return [...withoutComments(css).matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap(([, selector]) =>
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

/** The SFC's outermost `<template>`, which prettier keeps at column 0. */
function templateOf(source) {
    const block = source.match(/^<template>\r?\n([\s\S]*?)\r?\n<\/template\s*>/im);
    return block ? withoutComments(block[1]) : null;
}

// Quoted runs are consumed whole, because an attribute value here contains
// `=>` often enough that a `[^>]*` tag pattern loses track of the nesting and
// starts reporting descendants as roots.
const TAG = /<(\/?)([A-Za-z][\w.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)\s*(\/?)>/g;
const VOID_TAGS = new Set(['area', 'br', 'hr', 'img', 'input', 'link', 'meta', 'source']);

/** Top-level nodes of a template — a `v-if`/`v-else` pair is two of them. */
function rootNodes(template) {
    const roots = [];
    let depth = 0;
    for (const [, closing, tag, attributes, selfClosed] of template.matchAll(TAG)) {
        if (closing) {
            depth -= 1;
            continue;
        }
        if (depth === 0) roots.push({ tag, attributes });
        if (!selfClosed && !VOID_TAGS.has(tag.toLowerCase())) depth += 1;
    }
    return roots;
}

/** Class names a node carries, from `class` and from a `:class` binding. */
function classNames(attributes) {
    const values = [...attributes.matchAll(/:?class\s*=\s*"([^"]*)"/g)].map(([, value]) => value);
    return new Set(values.flatMap((value) => value.split(/[\s'"[\]{},:]+/)).filter(Boolean));
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
    const template = templateOf(source);
    if (!template) return false;
    const imports = componentImports(file, source);

    return rootNodes(template).every((root) => {
        if ([...classNames(root.attributes)].some((name) => markers.has(name))) return true;
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
        // The whole guard rests on reading markup, so it has to stop reading
        // markup that is commented out. Both HTML comment endings are covered:
        // matching only `-->` let a `--!>` comment through, and a marker inside
        // it would have satisfied the check below without ever rendering.
        for (const ending of ['-->', '--!>']) {
            const source = `<template>\n<!-- <div class="sa-page"> ${ending}\n<div class="thing" />\n</template>`;
            assert.equal(
                /class="[^"]*\bsa-page\b/.test(withoutComments(source)),
                false,
                `a commented-out marker survived a comment ending in ${ending}`,
            );
        }
        // And an uncommented one still does count, or the case above would
        // pass on a stripper that deletes everything.
        assert.ok(
            /class="[^"]*\bsa-page\b/.test(
                withoutComments('<template>\n<div class="sa-page" />\n</template>'),
            ),
        );
    });

    test('every standard page renders a node inside that reach', () => {
        const files = readdirSync(PAGES)
            .filter((name) => name.endsWith('.vue'))
            .map((name) => join(PAGES, name));

        // The shell is not a page. It renders Quasar's own layout, and the
        // theme paints it through `.sa-admin-layout` in base.css instead — so
        // asking it for a page marker would be asking the wrong question.
        const layouts = files.filter((file) => /<q-layout[\s>]/.test(readFileSync(file, 'utf8')));
        assert.equal(
            layouts.length,
            1,
            `${layouts.length} files render a Quasar layout; the exemption assumes exactly one`,
        );

        const pages = files.filter((file) => !layouts.includes(file));
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
