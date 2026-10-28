// What the package's templates use of Quasar, the test mount registers.
//
// In an app, `@quasar/vite-plugin` resolves every `q-*` tag and Quasar
// directive of a template; in a test nothing does but `mountWithQuasar`. A tag
// it lacks renders as an unknown element, and a test that reads the page reads
// nothing there — and passes. So the tags and directives are read off the
// templates themselves, and every one has to be registered: a tag the
// templates misspell, or one a Quasar upgrade removed, fails here as well.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';
import { defineComponent } from 'vue';

import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';

// `process.cwd()` rather than `import.meta.url`: under jsdom the module's URL is no file.
const SRC = join(process.cwd(), 'src');
/** The directives Vue itself understands; every other one a template names is someone's to register. */
const VUE_DIRECTIVES = new Set([
    'bind',
    'cloak',
    'else',
    'else-if',
    'for',
    'html',
    'if',
    'memo',
    'model',
    'on',
    'once',
    'pre',
    'show',
    'slot',
    'text',
]);

/** Every `.vue` file under `directory`, recursively. */
function templatesUnder(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return templatesUnder(path);
        return entry.name.endsWith('.vue') ? [path] : [];
    });
}

/** `close-popup` → `ClosePopup`, `btn-toggle` → `BtnToggle`. */
const pascal = (kebab: string) =>
    kebab
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');

const sources = templatesUnder(SRC).map((path) => readFileSync(path, 'utf8'));
const tags = new Set(
    sources.flatMap((text) =>
        [...text.matchAll(/<q-([a-z][a-z0-9-]*)/g)].map((m) => `Q${pascal(m[1]!)}`),
    ),
);
const directives = new Set(
    sources
        .flatMap((text) => [...text.matchAll(/\sv-([a-z][a-z-]*)/g)].map((m) => m[1]!))
        .filter((name) => !VUE_DIRECTIVES.has(name))
        .map(pascal),
);

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
});

/** The components and directives the test mount's app has registered. */
function registered() {
    const wrapper = mountWithQuasar(defineComponent({ template: '<div />' }));
    mounted.push(wrapper);
    const { components, directives: known } = wrapper.vm.$.appContext;
    return { components: Object.keys(components), directives: Object.keys(known) };
}

describe('the test mount', () => {
    test('reads the templates it holds the mount to', () => {
        // Below this the read would have found nothing to hold, and passed.
        expect(tags.size).toBeGreaterThan(30);
        expect([...directives]).toContain('ClosePopup');
    });

    test('registers every Quasar component a template of the package uses', () => {
        const { components } = registered();

        expect([...tags].filter((tag) => !components.includes(tag))).toEqual([]);
    });

    test('registers every directive a template of the package uses', () => {
        const { directives: known } = registered();

        expect([...directives].filter((name) => !known.includes(name))).toEqual([]);
    });
});
