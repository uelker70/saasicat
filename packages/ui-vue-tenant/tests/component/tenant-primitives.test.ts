// @requirement SC-UI-013 — A tenant-facing section can be embedded without adopting a UI framework

import { describe, expect, test } from 'vitest';
import { mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import TenantButton from '../../src/ui/TenantButton.vue';
import TenantCard from '../../src/ui/TenantCard.vue';
import TenantCardActions from '../../src/ui/TenantCardActions.vue';
import TenantCardSection from '../../src/ui/TenantCardSection.vue';

// The primitives that replace this package's Quasar components.
//
// Most of what they do is a class, and a test that asserts a class name only
// restates the template. What is asserted here is the half a rewrite can break
// without anybody noticing: that the button is still a real `<button>`, that a
// name and a listener from the call site still land ON it rather than on a
// wrapper around it, and that a running button is still announced and still
// readable.
//
// `mount`, not `mountWithQuasar`: needing the Quasar plugin to render these
// would mean they had not replaced anything.

describe('the tenant button is a button', () => {
    test('it renders a native button that does not submit', () => {
        // `<div role="button">` looks identical and is not reachable by
        // keyboard; `type="submit"` inside the customer's form reloads a page
        // nobody asked to reload.
        const wrapper = mount(TenantButton, { slots: { default: 'Change plan' } });
        expect(wrapper.element.tagName).toBe('BUTTON');
        expect(wrapper.attributes('type')).toBe('button');
    });

    test('an accessible name from the call site lands on the button itself', () => {
        // A wrapper element around the button would take this attribute and
        // leave the control unnamed — the failure an icon-only button makes
        // invisible, because there is no label to notice missing.
        const wrapper = mount(TenantButton, {
            props: { iconOnly: true },
            attrs: { 'aria-label': 'Close' },
        });
        expect(wrapper.element.tagName).toBe('BUTTON');
        expect(wrapper.attributes('aria-label')).toBe('Close');
    });

    test('a click listener from the call site reaches the button', async () => {
        const wrapper = mount(TenantButton, { slots: { default: 'Book' } });
        await wrapper.trigger('click');
        expect(wrapper.emitted('click')).toHaveLength(1);
    });

    test('the two axes are independent', () => {
        // A destructive action exists in both the loud and the quiet form, so
        // `variant` and `tone` may not collapse into one list of names.
        const quietDanger = mount(TenantButton, { props: { variant: 'quiet', tone: 'danger' } });
        expect(quietDanger.classes()).toContain('sp-btn--quiet');
        expect(quietDanger.classes()).toContain('sp-btn--danger');

        const solidDanger = mount(TenantButton, { props: { variant: 'solid', tone: 'danger' } });
        expect(solidDanger.classes()).toContain('sp-btn--solid');
        expect(solidDanger.classes()).toContain('sp-btn--danger');
    });
});

describe('a running button says so and stays readable', () => {
    test('loading disables the button and marks it busy', async () => {
        const wrapper = mount(TenantButton, {
            props: { loading: true },
            slots: { default: 'Booking…' },
        });
        expect(wrapper.attributes('disabled')).toBeDefined();
        expect(wrapper.attributes('aria-busy')).toBe('true');

        await wrapper.trigger('click');
        expect(wrapper.emitted('click')).toBeUndefined();
    });

    test('the ring is added beside the label, not instead of it', () => {
        // Replacing the label would leave a screen reader with a button whose
        // name disappeared at the moment it was pressed.
        const wrapper = mount(TenantButton, {
            props: { loading: true },
            slots: { default: 'Booking…' },
        });
        expect(wrapper.text()).toContain('Booking…');
        const ring = wrapper.get('.sp-spinner');
        expect(ring.attributes('aria-hidden')).toBe('true');
    });

    test('a disabled button is not a busy one', () => {
        const wrapper = mount(TenantButton, { props: { disabled: true } });
        expect(wrapper.attributes('disabled')).toBeDefined();
        expect(wrapper.attributes('aria-busy')).toBeUndefined();
    });
});

describe('the card primitives are one element each', () => {
    // Scoped styles reach a child component's ROOT element. A primitive that
    // rendered a wrapper would put that element out of the parent's reach, and
    // every layout rule written against it would silently do nothing.
    test.each([
        ['TenantCard', TenantCard, 'sp-card'],
        ['TenantCardSection', TenantCardSection, 'sp-card-section'],
        ['TenantCardActions', TenantCardActions, 'sp-card-actions'],
    ])('%s renders its slot inside one classed element', (_name, component, className) => {
        const wrapper = mount(component, { slots: { default: '<p>content</p>' } });
        expect(wrapper.classes()).toContain(className);
        expect(wrapper.get('p').text()).toBe('content');
    });
});

describe('the spinner respects a reduced-motion preference', () => {
    // jsdom answers no media query, so the claim is made against the
    // stylesheet: there is a `reduce` block, and it re-aims the spinner's
    // animation rather than leaving the turn running under a different name.
    // `process.cwd()` rather than `import.meta.url`: under jsdom the module's
    // own URL is an `http://` one, and `fileURLToPath` refuses it. Vitest's
    // `root` is this package, which is what the runner is started from.
    const css = readFileSync(join(process.cwd(), 'src/ui/tenant-ui.css'), 'utf8');

    test('the default animation turns', () => {
        expect(css).toContain('animation: sp-spinner-turn');
    });

    test('a reduce block replaces the turn for the spinner', () => {
        const at = css.indexOf('@media (prefers-reduced-motion: reduce)');
        expect(at).toBeGreaterThan(-1);
        const block = css.slice(at, css.indexOf('}', css.indexOf('}', at) + 1) + 1);
        expect(block).toContain('.sp-spinner');
        expect(block).not.toContain('sp-spinner-turn');
        expect(block).toContain('animation:');
    });
});
