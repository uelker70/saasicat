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

beforeEach(() => {
    document.documentElement.style.removeProperty('--q-primary');
    document.body.style.removeProperty('--q-primary');
});

afterEach(() => {
    document.documentElement.style.removeProperty('--q-primary');
    document.body.style.removeProperty('--q-primary');
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
