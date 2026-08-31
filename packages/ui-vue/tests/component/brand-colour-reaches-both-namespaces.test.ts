// @requirement SC-UI-015 — One colour makes the administration look like the integrator's product

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineComponent, h } from 'vue';

import { createSuperAdminApp } from '../../src/quasar/create-super-admin-app.js';

// One value, two namespaces — and the element it is written to is the whole
// question.
//
// `--sa-color-accent` is declared as `var(--q-primary, …)`, so writing Quasar's
// variable carries the platform's accent role with it. But `setCssVar` defaults
// to `document.body`, and a role computed on `:root` never sees a value written
// there. This repository has already paid for that once: a brand colour arrived
// on the page and the accent role stayed blue.
//
// So the assertion is not "the variable is set" — it is "the variable is set
// WHERE the role that reads it is computed".

const Root = defineComponent({ setup: () => () => h('div') });

function boot(brand: Record<string, unknown>) {
    return createSuperAdminApp({
        rootComponent: Root,
        brand,
        endpoints: { apiBase: '/api/v1/admin' },
        appRoutes: [{ path: '/:pathMatch(.*)*', component: Root }],
        theme: { persist: false },
    } as never);
}

const brandOn = (element: HTMLElement) => element.style.getPropertyValue('--q-primary');

/** The status tones the platform owns rather than the consumer. */
const STATUS_TONES = ['positive', 'negative', 'warning', 'info'] as const;

const WRITTEN = ['--q-primary', ...STATUS_TONES.map((tone) => `--q-${tone}`)];

beforeEach(() => {
    for (const name of WRITTEN) {
        document.documentElement.style.removeProperty(name);
        document.body.style.removeProperty(name);
    }
});

afterEach(() => {
    for (const name of WRITTEN) {
        document.documentElement.style.removeProperty(name);
        document.body.style.removeProperty(name);
    }
});

describe('the brand colour replaces $primary', () => {
    test('it lands on the document element, not the body', () => {
        boot({ name: 'Fixture', logoText: 'FX', color: '#3f6bff' });
        expect(brandOn(document.documentElement)).toBe('#3f6bff');
        expect(brandOn(document.body)).toBe('');
    });

    test('an app that names no colour leaves the variable alone', () => {
        // Quasar publishes its own default on `:root`; writing an empty value
        // over it would replace a colour with nothing.
        boot({ name: 'Fixture', logoText: 'FX' });
        expect(brandOn(document.documentElement)).toBe('');
    });

    test('the colour is also handed to the components as part of the brand', () => {
        const { app } = boot({ name: 'Fixture', logoText: 'FX', color: 'rebeccapurple' });
        const provides = (app as unknown as { _context: { provides: Record<symbol, unknown> } })
            ._context.provides;
        const brand = Object.getOwnPropertySymbols(provides)
            .map((key) => provides[key])
            .find(
                (value): value is { color?: string } =>
                    typeof value === 'object' && value !== null && 'logoText' in value,
            );
        expect(brand?.color).toBe('rebeccapurple');
    });
});

describe('disposing gives the document back', () => {
    // The value is written on `<html>`, which outlives the shell that wrote it.
    // A hot reload or a micro-frontend swapping views creates a second shell in
    // the same document, and without this it inherits the first one's brand.

    test('a shell that set a colour removes it again', () => {
        const { dispose } = boot({ name: 'Fixture', logoText: 'FX', color: '#3f6bff' });
        expect(brandOn(document.documentElement)).toBe('#3f6bff');

        dispose();
        expect(brandOn(document.documentElement)).toBe('');
    });

    test('a host value marked !important keeps its priority', () => {
        // Restoring the value alone silently demotes the declaration, and an
        // author-level `!important` rule then outranks what used to win. The
        // page would be a different colour after this shell leaves than before
        // it arrived — the opposite of what disposal promises.
        document.documentElement.style.setProperty('--q-primary', 'rebeccapurple', 'important');

        boot({ name: 'Fixture', logoText: 'FX', color: '#3f6bff' }).dispose();

        expect(brandOn(document.documentElement)).toBe('rebeccapurple');
        expect(document.documentElement.style.getPropertyPriority('--q-primary')).toBe('important');
    });

    test('our own writes claim no priority of their own', () => {
        // A shell that wrote `!important` would outrank the consumer's own
        // stylesheet for as long as it lives, which is not a decision this
        // package gets to make on their behalf.
        boot({ name: 'Fixture', logoText: 'FX', color: '#3f6bff' });
        expect(document.documentElement.style.getPropertyPriority('--q-primary')).toBe('');
        expect(document.documentElement.style.getPropertyPriority('--q-warning')).toBe('');
    });

    test('a value the host set itself is put back, not deleted', () => {
        // Removing unconditionally would take a host's own branding with it —
        // the failure is silent and permanent for that page.
        document.documentElement.style.setProperty('--q-primary', 'rebeccapurple');

        const { dispose } = boot({ name: 'Fixture', logoText: 'FX', color: '#3f6bff' });
        expect(brandOn(document.documentElement)).toBe('#3f6bff');

        dispose();
        expect(brandOn(document.documentElement)).toBe('rebeccapurple');
    });

    test('a shell that named no colour touches nothing on the way out', () => {
        document.documentElement.style.setProperty('--q-primary', 'rebeccapurple');
        boot({ name: 'Fixture', logoText: 'FX' }).dispose();
        expect(brandOn(document.documentElement)).toBe('rebeccapurple');
    });
});

describe('the theme declares the link the option relies on', () => {
    test('the accent role reads Quasar’s variable', () => {
        // Without this declaration the option above sets a variable nothing
        // reads, and every assertion here would still pass.
        //
        // `process.cwd()` rather than `import.meta.url`: under jsdom the
        // module's own URL is an `http://` one. Vitest's `root` is this package.
        const css = readFileSync(
            join(process.cwd(), 'src/ui/theme/tokens.semantic.light.css'),
            'utf8',
        );
        expect(css).toMatch(/--sa-color-accent:\s*var\(--q-primary/);
    });
});

describe('the status tones follow the roles instead of being restated', () => {
    // These are not branding, and until phase 8 the scaffolder asked the
    // consumer to restate them in Sass. One of the four had drifted:
    // `$warning: #f59e0b` against a `--sa-color-warning` that resolves to
    // `#b45309`, so `color="warning"` painted 2.15:1 on white beside a role
    // painting 4.8:1.
    //
    // The mapping is four lines of CSS, not a runtime write, so what a booted
    // shell can show is that it does NOT write them. The stylesheet's own
    // claims are `tests/filled-status-carries-white-text.test.js`.

    test('the shell writes no status colour of its own', () => {
        boot({ name: 'Fixture', logoText: 'FX', color: '#3f6bff' });
        for (const tone of STATUS_TONES) {
            expect(
                document.documentElement.style.getPropertyValue(`--q-${tone}`),
                `--q-${tone} is written at runtime again; the theme owns this mapping`,
            ).toBe('');
        }
    });

    test('the theme hands Quasar the filled role, in both schemes', () => {
        // Quasar paints `--q-warning` as a BACKGROUND with white text. The
        // plain role is a foreground and goes lighter in the dark theme, where
        // white on it reads 1.67:1 — which is what the browser sweep failed on
        // when this pointed at the plain role.
        for (const scheme of ['light', 'dark']) {
            const css = readFileSync(
                join(process.cwd(), `src/ui/theme/tokens.semantic.${scheme}.css`),
                'utf8',
            );
            for (const tone of STATUS_TONES) {
                expect(css, `${scheme} does not hand Quasar --q-${tone}`).toContain(
                    `--q-${tone}: var(--sa-color-${tone}-solid);`,
                );
            }
        }
    });
});
