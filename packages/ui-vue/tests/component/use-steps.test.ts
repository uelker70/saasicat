import { describe, expect, test } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';

import { useSteps } from '../../src/vue/use-steps.js';

// A wizard's position, its guard, and the focus move that has no picture.
//
// `.value` throughout: the composable returns refs inside an object, so
// `setup`'s unwrapping does not reach them — which is what a caller sees too
// unless it destructures first, and the wizard does destructure.
//
// Two claims here would survive any snapshot: that a guarded step refuses to
// advance, and that focus lands on the heading of the step that just appeared.
// The second is the one a rewrite loses silently — the panel changes, the page
// looks right, and a screen reader is told nothing.

const STEPS = ['choose', 'preview', 'confirm'] as const;
type Step = (typeof STEPS)[number];

function host(canLeave?: (step: Step) => boolean) {
    return defineComponent({
        setup() {
            const steps = useSteps<Step>({ steps: STEPS, canLeave });
            return { steps };
        },
        render() {
            return h('div', [
                h(
                    'h3',
                    { ref: this.steps.headingRef, ...this.steps.headingProps },
                    `step: ${this.steps.current.value}`,
                ),
                h('button', { class: 'back', onClick: () => this.steps.back() }, 'back'),
                h('button', { class: 'next', onClick: () => this.steps.next() }, 'next'),
            ]);
        },
    });
}

function mountHost(canLeave?: (step: Step) => boolean) {
    return mount(host(canLeave), { attachTo: document.body });
}

describe('a linear wizard knows where it is', () => {
    test('it starts on the first step', () => {
        const wrapper = mountHost();
        expect(wrapper.vm.steps.current.value).toBe('choose');
        expect(wrapper.vm.steps.isFirst.value).toBe(true);
        expect(wrapper.vm.steps.isLast.value).toBe(false);
    });

    test('every step is done, current or upcoming', async () => {
        const wrapper = mountHost();
        expect(STEPS.map((s) => wrapper.vm.steps.statusOf(s))).toEqual([
            'current',
            'upcoming',
            'upcoming',
        ]);

        await wrapper.get('.next').trigger('click');
        expect(STEPS.map((s) => wrapper.vm.steps.statusOf(s))).toEqual([
            'done',
            'current',
            'upcoming',
        ]);
    });

    test('back on the first step is refused rather than wrapping around', async () => {
        const wrapper = mountHost();
        expect(wrapper.vm.steps.back()).toBe(false);
        expect(wrapper.vm.steps.current.value).toBe('choose');
    });

    test('next on the last step is refused', async () => {
        const wrapper = mountHost();
        wrapper.vm.steps.next();
        wrapper.vm.steps.next();
        await nextTick();
        expect(wrapper.vm.steps.isLast.value).toBe(true);
        expect(wrapper.vm.steps.next()).toBe(false);
        expect(wrapper.vm.steps.current.value).toBe('confirm');
    });

    test('reset takes it back to the start', async () => {
        const wrapper = mountHost();
        wrapper.vm.steps.next();
        wrapper.vm.steps.reset();
        await nextTick();
        expect(wrapper.vm.steps.current.value).toBe('choose');
    });
});

describe('a guarded step refuses to advance', () => {
    test('the guard stops the move and says so', async () => {
        const wrapper = mountHost((step) => step !== 'choose');
        expect(wrapper.vm.steps.canAdvance.value).toBe(false);
        expect(wrapper.vm.steps.next()).toBe(false);
        await nextTick();
        expect(wrapper.vm.steps.current.value).toBe('choose');
    });

    test('a click on a next button the guard refuses moves nothing', async () => {
        const wrapper = mountHost((step) => step !== 'choose');
        await wrapper.get('.next').trigger('click');
        expect(wrapper.vm.steps.current.value).toBe('choose');
    });

    test('the same predicate answers the button and the move', async () => {
        // Two predicates drift: the button enables while the move refuses, or
        // the reverse, and the user is left pressing something inert. A ref,
        // because that is what the wizard's guard reads — a plain variable
        // would only test the caching of this test's own closure.
        const open = ref(false);
        const wrapper = mountHost(() => open.value);
        expect(wrapper.vm.steps.canAdvance.value).toBe(false);
        expect(wrapper.vm.steps.next()).toBe(false);

        open.value = true;
        await nextTick();
        expect(wrapper.vm.steps.canAdvance.value).toBe(true);
        expect(wrapper.vm.steps.next()).toBe(true);
        expect(wrapper.vm.steps.current.value).toBe('preview');
    });
});

describe('focus follows the step', () => {
    test('advancing puts focus on the new heading', async () => {
        const wrapper = mountHost();
        const heading = wrapper.get('h3').element as HTMLElement;
        expect(document.activeElement).not.toBe(heading);

        await wrapper.get('.next').trigger('click');
        await nextTick();
        expect(document.activeElement).toBe(heading);
        expect(heading.textContent).toBe('step: preview');
    });

    test('going back puts focus on the heading too', async () => {
        const wrapper = mountHost();
        await wrapper.get('.next').trigger('click');
        await nextTick();
        (document.activeElement as HTMLElement).blur();

        await wrapper.get('.back').trigger('click');
        await nextTick();
        expect(document.activeElement).toBe(wrapper.get('h3').element);
    });

    test('a refused move does not move focus', async () => {
        const wrapper = mountHost((step) => step !== 'choose');
        await wrapper.get('.next').trigger('click');
        await nextTick();
        expect(document.activeElement).not.toBe(wrapper.get('h3').element);
    });

    test('the heading is focusable without joining the tab order', () => {
        const wrapper = mountHost();
        expect(wrapper.get('h3').attributes('tabindex')).toBe('-1');
    });
});

describe('a wizard with no steps is a mistake, not an empty wizard', () => {
    test('it refuses to be built', () => {
        expect(() => useSteps({ steps: [] })).toThrow(/at least one step/);
    });
});
