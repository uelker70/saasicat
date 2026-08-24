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
        endpoints: { apiBase: '/api/v1/admin', projectKey: 'demo' },
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
    // painting 4.8:1. Restating a value is how it drifts, so the shell points
    // Quasar at the role itself.

    test('each one is linked through var(), not copied', () => {
        boot({ name: 'Fixture', logoText: 'FX', color: '#3f6bff' });
        for (const tone of STATUS_TONES) {
            expect(document.documentElement.style.getPropertyValue(`--q-${tone}`)).toBe(
                `var(--sa-color-${tone}-solid)`,
            );
        }
    });

    test('the tone it points at is the filled one, not the foreground', () => {
        // Quasar paints `--q-warning` as a BACKGROUND with white text. The
        // plain role is a foreground and goes lighter in the dark theme, where
        // white on it reads 1.67:1 — which is what the browser sweep failed on
        // when this pointed at the plain role. `tests/filled-status-carries-
        // white-text.test.js` pins the pair; this pins which one is used.
        const dark = readFileSync(
            join(process.cwd(), 'src/ui/theme/tokens.semantic.dark.css'),
            'utf8',
        );
        for (const tone of STATUS_TONES) {
            expect(dark, `--sa-color-${tone}-solid is missing from the dark theme`).toContain(
                `--sa-color-${tone}-solid:`,
            );
        }
    });

    test('an app that names no brand colour still gets them', () => {
        // They are the platform's, not the consumer's — so they do not hang off
        // an option the consumer may omit.
        boot({ name: 'Fixture', logoText: 'FX' });
        expect(document.documentElement.style.getPropertyValue('--q-warning')).toBe(
            'var(--sa-color-warning-solid)',
        );
    });

    test('disposing unlinks them again', () => {
        const { dispose } = boot({ name: 'Fixture', logoText: 'FX', color: '#3f6bff' });
        dispose();
        for (const tone of STATUS_TONES) {
            expect(document.documentElement.style.getPropertyValue(`--q-${tone}`)).toBe('');
        }
    });

    test('a host that set one itself gets it back', () => {
        document.documentElement.style.setProperty('--q-negative', 'rebeccapurple');
        boot({ name: 'Fixture', logoText: 'FX' }).dispose();
        expect(document.documentElement.style.getPropertyValue('--q-negative')).toBe(
            'rebeccapurple',
        );
    });
});
