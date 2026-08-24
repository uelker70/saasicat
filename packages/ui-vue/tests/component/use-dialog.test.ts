import { afterEach, describe, expect, test } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';

import { useDialog } from '../../src/vue/use-dialog.js';

// The half of a dialog that no snapshot sees.
//
// Focus return is the one everybody forgets: the dialog closes, the page looks
// right, and a keyboard user is back at the top of the document with no idea
// where they were. It has no visual output at all, so it needs a test of its
// own — and so does every other claim here, because the whole point of a
// headless primitive is that a behaviour proved once is then correct in all
// three dialogs that use it.
//
// The host below renders with `h()` rather than a template string: the runtime
// compiler is not in the build vitest loads, and a render function shows the
// binding contract — panel ref, panel props, backdrop props — more plainly than
// a template does.

interface HostProps {
    open: boolean;
    persistent?: boolean;
    to?: string;
    tabbables?: number;
}

const closes: string[] = [];

function makeHost(name: string) {
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
                to: props.to ? () => props.to as string : undefined,
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
const mounted: VueWrapper[] = [];

function open(props: Partial<HostProps> = {}, component = Host) {
    const wrapper = mount(component, {
        props: { open: true, ...props },
        attachTo: document.body,
    });
    mounted.push(wrapper as VueWrapper);
    return wrapper;
}

/** A real, focused element for the dialog to come back to. */
function trigger(): HTMLButtonElement {
    const button = document.createElement('button');
    button.textContent = 'Change plan';
    document.body.append(button);
    button.focus();
    return button;
}

afterEach(() => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = '';
    document.body.style.overflow = '';
    closes.length = 0;
});

describe('the dialog is announced as one', () => {
    test('the panel carries the modal role and is named by its heading', () => {
        const wrapper = open();
        const panel = wrapper.get('.panel');
        expect(panel.attributes('role')).toBe('dialog');
        expect(panel.attributes('aria-modal')).toBe('true');

        const named = panel.attributes('aria-labelledby');
        expect(named).toBeTruthy();
        expect(wrapper.get('h2').attributes('id')).toBe(named);
    });
});

describe('focus enters and comes back', () => {
    test('opening moves focus into the panel', async () => {
        trigger();
        const wrapper = open();
        await nextTick();
        expect(document.activeElement).toBe(wrapper.get('.panel').element);
    });

    test('closing puts focus back where it was', async () => {
        const button = trigger();
        const wrapper = open();
        await nextTick();
        expect(document.activeElement).not.toBe(button);

        await wrapper.setProps({ open: false });
        expect(document.activeElement).toBe(button);
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
        expect(document.activeElement).toBe(document.body);
    });

    test('unmounting while open still gives the focus back', async () => {
        const button = trigger();
        const wrapper = mount(Host, { props: { open: true }, attachTo: document.body });
        await nextTick();
        wrapper.unmount();
        expect(document.activeElement).toBe(button);
    });
});

describe('the trap keeps tab inside the panel', () => {
    function tab(shiftKey = false) {
        const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true });
        document.dispatchEvent(event);
        return event;
    }

    test('tab from the last control wraps to the first', async () => {
        const wrapper = open();
        await nextTick();
        const first = wrapper.get('.focusable-0').element as HTMLElement;
        const last = wrapper.get('.focusable-1').element as HTMLElement;

        last.focus();
        const event = tab();
        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(first);
    });

    test('shift+tab from the first control wraps to the last', async () => {
        const wrapper = open();
        await nextTick();
        const first = wrapper.get('.focusable-0').element as HTMLElement;
        const last = wrapper.get('.focusable-1').element as HTMLElement;

        first.focus();
        const event = tab(true);
        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(last);
    });

    test('shift+tab from the panel itself wraps to the last control', async () => {
        // The panel is where focus starts, and it is the first thing in the
        // panel — so backwards from there leaves without an interception.
        const wrapper = open();
        await nextTick();
        const last = wrapper.get('.focusable-1').element as HTMLElement;

        tab(true);
        expect(document.activeElement).toBe(last);
    });

    test('a tab from outside the panel is pulled back in', async () => {
        const outside = trigger();
        const wrapper = open();
        await nextTick();

        outside.focus();
        tab();
        expect(document.activeElement).toBe(wrapper.get('.focusable-0').element);
    });

    test('a panel with nothing tabbable keeps the caret on itself', async () => {
        const wrapper = open({ tabbables: 0 });
        await nextTick();
        tab();
        expect(document.activeElement).toBe(wrapper.get('.panel').element);
    });
});

describe('escape and the backdrop', () => {
    function escape() {
        const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
        document.dispatchEvent(event);
        return event;
    }

    test('escape asks the caller to close', async () => {
        open();
        await nextTick();
        expect(escape().defaultPrevented).toBe(true);
        expect(closes).toEqual(['host']);
    });

    test('a persistent dialog ignores escape', async () => {
        open({ persistent: true });
        await nextTick();
        expect(escape().defaultPrevented).toBe(false);
        expect(closes).toEqual([]);
    });

    test('a click on the backdrop closes, a click in the panel does not', async () => {
        const wrapper = open();
        await nextTick();

        await wrapper.get('.panel').trigger('click');
        expect(closes).toEqual([]);

        await wrapper.get('.backdrop').trigger('click');
        expect(closes).toEqual(['host']);
    });

    test('a persistent dialog ignores the backdrop too', async () => {
        const wrapper = open({ persistent: true });
        await nextTick();
        await wrapper.get('.backdrop').trigger('click');
        expect(closes).toEqual([]);
    });

    test('a closed dialog no longer answers escape', async () => {
        const wrapper = open();
        await nextTick();
        await wrapper.setProps({ open: false });
        escape();
        expect(closes).toEqual([]);
    });
});

describe('the page behind does not scroll', () => {
    test('the lock is taken while open and given back on close', async () => {
        document.body.style.overflow = 'auto';
        const wrapper = open();
        await nextTick();
        expect(document.body.style.overflow).toBe('hidden');

        await wrapper.setProps({ open: false });
        expect(document.body.style.overflow).toBe('auto');
    });

    test('an inner dialog closing does not give the page back to the outer one', async () => {
        const Inner = makeHost('inner');
        const outer = open();
        const inner = open({}, Inner);
        await nextTick();
        expect(document.body.style.overflow).toBe('hidden');

        await inner.setProps({ open: false });
        expect(document.body.style.overflow).toBe('hidden');

        await outer.setProps({ open: false });
        expect(document.body.style.overflow).toBe('');
    });
});

describe('the panel can be teleported somewhere other than body', () => {
    test('the default is body', () => {
        const wrapper = open();
        // Nested in the returned object, so `setup`'s unwrapping does not
        // reach it — which is also true in a template, where the caller writes
        // `dialog.teleportTo.value` or destructures first.
        expect(wrapper.vm.dialog.teleportTo.value).toBe('body');
    });

    test('a host that names a container gets it', () => {
        const wrapper = open({ to: '#host-theme-root' });
        expect(wrapper.vm.dialog.teleportTo.value).toBe('#host-theme-root');
    });
});
