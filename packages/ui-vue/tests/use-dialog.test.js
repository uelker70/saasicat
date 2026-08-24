// The half of a dialog that no snapshot sees.
//
// Focus return is the one everybody forgets: the dialog closes, the page looks
// right, and a keyboard user is back at the top of the document with no idea
// where they were. It has no visual output at all, so it needs a test of its
// own — and so does every other claim here, because the whole point of a
// headless primitive is that a behaviour proved once is then correct in all
// four dialogs that use it.
//
// In this suite rather than the component runner, and imported from `dist/`,
// for the two reasons that suite exists: it is what the coverage ratchet
// measures, and it is the bundle a consumer actually loads. The component
// runner is for files that need compiling; these do not.
//
// The host below renders with `h()` rather than a template: no compiler is
// loaded here, and a render function shows the binding contract — panel ref,
// panel props, backdrop props — more plainly than a template does.

import { after, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './support/dom.mjs';

const { document, KeyboardEvent, teardown: teardownDom } = installDom();
const { mount } = await import('@vue/test-utils');
const { defineComponent, h, nextTick } = await import('vue');
const { useDialog } = await import('../dist/index.js');

after(teardownDom);

const closes = [];
const mounted = [];

function makeHost(name) {
    return defineComponent({
        name,
        props: {
            open: { type: Boolean, required: true },
            persistent: { type: Boolean, default: false },
            to: { type: String, default: undefined },
            tabbables: { type: Number, default: 2 },
        },
        setup(props) {
            const dialog = useDialog({
                open: () => props.open,
                onClose: () => closes.push(name),
                persistent: () => props.persistent,
                to: props.to ? () => props.to : undefined,
            });
            return { dialog };
        },
        render() {
            if (!this.open) return null;
            const buttons = Array.from({ length: this.tabbables }, (_, index) =>
                h('button', { class: `focusable-${index}`, key: index }, `button ${index}`),
            );
            return h('div', { class: 'backdrop', ...this.dialog.backdropProps }, [
                h('div', { ref: this.dialog.panelRef, class: 'panel', ...this.dialog.panelProps }, [
                    h('h2', { id: this.dialog.titleId }, 'Change plan'),
                    ...buttons,
                ]),
            ]);
        },
    });
}

const Host = makeHost('host');

function open(props = {}, component = Host) {
    const wrapper = mount(component, { props: { open: true, ...props }, attachTo: document.body });
    mounted.push(wrapper);
    return wrapper;
}

/** A real, focused element for the dialog to come back to. */
function trigger() {
    const button = document.createElement('button');
    button.textContent = 'Change plan';
    document.body.append(button);
    button.focus();
    return button;
}

function press(key, shiftKey = false) {
    const event = new KeyboardEvent('keydown', { key, shiftKey, cancelable: true });
    document.dispatchEvent(event);
    return event;
}

beforeEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = '';
    document.body.style.overflow = '';
    closes.length = 0;
});

describe('the dialog is announced as one', () => {
    test('the panel carries the modal role and is named by its heading', () => {
        const wrapper = open();
        const panel = wrapper.get('.panel');
        assert.equal(panel.attributes('role'), 'dialog');
        assert.equal(panel.attributes('aria-modal'), 'true');

        const named = panel.attributes('aria-labelledby');
        assert.ok(named);
        assert.equal(wrapper.get('h2').attributes('id'), named);
    });
});

describe('focus enters and comes back', () => {
    test('opening moves focus into the panel', async () => {
        trigger();
        const wrapper = open();
        await nextTick();
        assert.equal(document.activeElement, wrapper.get('.panel').element);
    });

    test('closing puts focus back where it was', async () => {
        const button = trigger();
        const wrapper = open();
        await nextTick();
        assert.notEqual(document.activeElement, button);

        await wrapper.setProps({ open: false });
        assert.equal(document.activeElement, button);
    });

    test('a trigger that is gone by then leaves focus at the document body', async () => {
        // The row a dialog was opened from can be gone by the time it closes —
        // reactivating a bundle replaces the button that opened the dialog.
        // Focusing a detached node is a no-op, so focus ends up at `<body>`.
        // Pinned rather than guarded against: a guard for this measured as
        // making no difference, and the landing place is what a keyboard user
        // actually experiences.
        const button = trigger();
        const wrapper = open();
        await nextTick();

        button.remove();
        await wrapper.setProps({ open: false });
        assert.equal(document.activeElement, document.body);
    });

    test('unmounting while open still gives the focus back', async () => {
        const button = trigger();
        const wrapper = mount(Host, { props: { open: true }, attachTo: document.body });
        await nextTick();
        wrapper.unmount();
        assert.equal(document.activeElement, button);
    });
});

describe('the trap keeps tab inside the panel', () => {
    test('tab from the last control wraps to the first', async () => {
        const wrapper = open();
        await nextTick();
        const first = wrapper.get('.focusable-0').element;
        const last = wrapper.get('.focusable-1').element;

        last.focus();
        const event = press('Tab');
        assert.equal(event.defaultPrevented, true);
        assert.equal(document.activeElement, first);
    });

    test('shift+tab from the first control wraps to the last', async () => {
        const wrapper = open();
        await nextTick();
        const first = wrapper.get('.focusable-0').element;
        const last = wrapper.get('.focusable-1').element;

        first.focus();
        const event = press('Tab', true);
        assert.equal(event.defaultPrevented, true);
        assert.equal(document.activeElement, last);
    });

    test('shift+tab from the panel itself wraps to the last control', async () => {
        // The panel is where focus starts, and it is the first thing in the
        // panel — so backwards from there leaves without an interception.
        const wrapper = open();
        await nextTick();
        press('Tab', true);
        assert.equal(document.activeElement, wrapper.get('.focusable-1').element);
    });

    test('a tab from outside the panel is pulled back in', async () => {
        const outside = trigger();
        const wrapper = open();
        await nextTick();

        outside.focus();
        press('Tab');
        assert.equal(document.activeElement, wrapper.get('.focusable-0').element);
    });

    test('a panel with nothing tabbable keeps the caret on itself', async () => {
        const wrapper = open({ tabbables: 0 });
        await nextTick();
        press('Tab');
        assert.equal(document.activeElement, wrapper.get('.panel').element);
    });
});

describe('escape and the backdrop', () => {
    test('escape asks the caller to close', async () => {
        open();
        await nextTick();
        assert.equal(press('Escape').defaultPrevented, true);
        assert.deepEqual(closes, ['host']);
    });

    test('a persistent dialog ignores escape', async () => {
        open({ persistent: true });
        await nextTick();
        assert.equal(press('Escape').defaultPrevented, false);
        assert.deepEqual(closes, []);
    });

    test('a click on the backdrop closes, a click in the panel does not', async () => {
        const wrapper = open();
        await nextTick();

        await wrapper.get('.panel').trigger('click');
        assert.deepEqual(closes, []);

        await wrapper.get('.backdrop').trigger('click');
        assert.deepEqual(closes, ['host']);
    });

    test('a persistent dialog ignores the backdrop too', async () => {
        const wrapper = open({ persistent: true });
        await nextTick();
        await wrapper.get('.backdrop').trigger('click');
        assert.deepEqual(closes, []);
    });

    test('a closed dialog no longer answers escape', async () => {
        const wrapper = open();
        await nextTick();
        await wrapper.setProps({ open: false });
        press('Escape');
        assert.deepEqual(closes, []);
    });
});

describe('the page behind does not scroll', () => {
    test('the lock is taken while open and given back on close', async () => {
        document.body.style.overflow = 'auto';
        const wrapper = open();
        await nextTick();
        assert.equal(document.body.style.overflow, 'hidden');

        await wrapper.setProps({ open: false });
        assert.equal(document.body.style.overflow, 'auto');
    });

    test('an inner dialog closing does not give the page back to the outer one', async () => {
        const Inner = makeHost('inner');
        const outer = open();
        const inner = open({}, Inner);
        await nextTick();
        assert.equal(document.body.style.overflow, 'hidden');

        await inner.setProps({ open: false });
        assert.equal(document.body.style.overflow, 'hidden');

        await outer.setProps({ open: false });
        assert.equal(document.body.style.overflow, '');
    });
});

describe('the panel can be teleported somewhere other than body', () => {
    test('the default is body', () => {
        const wrapper = open();
        // Nested in the returned object, so `setup`'s unwrapping does not reach
        // it — which is what a caller sees too unless it destructures first.
        assert.equal(wrapper.vm.dialog.teleportTo.value, 'body');
    });

    test('a host that names a container gets it', () => {
        const wrapper = open({ to: '#host-theme-root' });
        assert.equal(wrapper.vm.dialog.teleportTo.value, '#host-theme-root');
    });
});
