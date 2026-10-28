// Mount helper for the SFC tests.
//
// `app.use(Quasar)` installs the plugin but registers no components — in an app
// that job belongs to `@quasar/vite-plugin`'s auto-import. Without registering
// them here every `q-*` stays an unresolved custom element, props end up as raw
// attributes and assertions pass or fail for reasons that have nothing to do
// with the component under test.

import * as quasar from 'quasar';
import { mount, type ComponentMountingOptions } from '@vue/test-utils';
import type { Component, Directive } from 'vue';

const isComponent = (name: string, value: unknown): value is Component =>
    /^Q[A-Z]/.test(name) &&
    typeof value === 'object' &&
    value !== null &&
    ('setup' in value || 'render' in value);

const isDirective = (value: unknown): value is Directive =>
    typeof value === 'object' &&
    value !== null &&
    !('setup' in value) &&
    ('beforeMount' in value || 'mounted' in value || 'created' in value);

/**
 * Every component and directive the installed Quasar exports, under the name
 * it exports it by, as an app's vite plugin resolves any `q-*` tag and Quasar
 * directive of a template. Read off the package rather than listed: a list is a
 * second inventory that falls behind the templates, and a tag it lacks renders
 * as an unknown element that a test reads as nothing being there.
 */
function quasarParts(): {
    components: Record<string, Component>;
    directives: Record<string, Directive>;
} {
    const components: Record<string, Component> = {};
    const directives: Record<string, Directive> = {};
    for (const [name, value] of Object.entries(quasar)) {
        if (isComponent(name, value)) components[name] = value;
        else if (isDirective(value)) directives[name] = value;
    }
    return { components, directives };
}

const QUASAR = quasarParts();

/**
 * A `ResizeObserver` that reports nothing. jsdom has none, and Quasar's
 * layout, tabs and scroll areas observe their size from the moment they mount,
 * so a page that uses one throws before it renders; a test reads what a page
 * shows, not how large it is.
 */
class SilentResizeObserver implements ResizeObserver {
    observe(): void {
        // Nothing is measured, so nothing is reported.
    }
    unobserve(): void {
        // Nothing was observed.
    }
    disconnect(): void {
        // Nothing to let go of.
    }
}

export function mountWithQuasar(
    component: Component,
    options: ComponentMountingOptions<Component> = {},
) {
    // The environment's own where it has one, as a browser does.
    if (typeof globalThis.ResizeObserver === 'undefined') {
        globalThis.ResizeObserver = SilentResizeObserver;
    }
    const { global: globalOptions = {}, ...rest } = options;
    return mount(component, {
        ...rest,
        global: {
            ...globalOptions,
            plugins: [quasar.Quasar, ...(globalOptions.plugins ?? [])],
            components: { ...QUASAR.components, ...globalOptions.components },
            directives: { ...QUASAR.directives, ...globalOptions.directives },
        },
    });
}
