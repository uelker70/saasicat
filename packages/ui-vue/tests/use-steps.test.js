// A wizard's position, its guard, and the focus move that has no picture.
//
// Two claims here would survive any snapshot: that a guarded step refuses to
// advance, and that focus lands on the heading of the step that just appeared.
// The second is the one a rewrite loses silently — the panel changes, the page
// looks right, and a screen reader is told nothing.
//
// `.value` throughout: the composable returns refs inside an object, so
// `setup`'s unwrapping does not reach them — which is what a caller sees unless
// it destructures first, and the wizard does destructure.

import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { installDom } from './support/dom.mjs';

const { document, teardown: teardownDom } = installDom();
const { mount } = await import('@vue/test-utils');
const { defineComponent, h, nextTick, ref } = await import('vue');
const { useSteps } = await import('../dist/index.js');

after(teardownDom);

const STEPS = ['choose', 'preview', 'confirm'];

function mountHost(canLeave) {
    const Host = defineComponent({
        setup() {
            const steps = useSteps({ steps: STEPS, canLeave });
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
    return mount(Host, { attachTo: document.body });
}

describe('a linear wizard knows where it is', () => {
    test('it starts on the first step', () => {
        const wrapper = mountHost();
        assert.equal(wrapper.vm.steps.current.value, 'choose');
        assert.equal(wrapper.vm.steps.isFirst.value, true);
        assert.equal(wrapper.vm.steps.isLast.value, false);
        wrapper.unmount();
    });

    test('every step is done, current or upcoming', async () => {
        const wrapper = mountHost();
        assert.deepEqual(
            STEPS.map((step) => wrapper.vm.steps.statusOf(step)),
            ['current', 'upcoming', 'upcoming'],
        );

        await wrapper.get('.next').trigger('click');
        assert.deepEqual(
            STEPS.map((step) => wrapper.vm.steps.statusOf(step)),
            ['done', 'current', 'upcoming'],
        );
        wrapper.unmount();
    });

    test('back on the first step is refused rather than wrapping around', () => {
        const wrapper = mountHost();
        assert.equal(wrapper.vm.steps.back(), false);
        assert.equal(wrapper.vm.steps.current.value, 'choose');
        wrapper.unmount();
    });

    test('next on the last step is refused', async () => {
        const wrapper = mountHost();
        wrapper.vm.steps.next();
        wrapper.vm.steps.next();
        await nextTick();
        assert.equal(wrapper.vm.steps.isLast.value, true);
        assert.equal(wrapper.vm.steps.next(), false);
        assert.equal(wrapper.vm.steps.current.value, 'confirm');
        wrapper.unmount();
    });

    test('reset takes it back to the start', async () => {
        const wrapper = mountHost();
        wrapper.vm.steps.next();
        wrapper.vm.steps.reset();
        await nextTick();
        assert.equal(wrapper.vm.steps.current.value, 'choose');
        wrapper.unmount();
    });
});

describe('a guarded step refuses to advance', () => {
    test('the guard stops the move and says so', async () => {
        const wrapper = mountHost((step) => step !== 'choose');
        assert.equal(wrapper.vm.steps.canAdvance.value, false);
        assert.equal(wrapper.vm.steps.next(), false);
        await nextTick();
        assert.equal(wrapper.vm.steps.current.value, 'choose');
        wrapper.unmount();
    });

    test('a click on a next button the guard refuses moves nothing', async () => {
        const wrapper = mountHost((step) => step !== 'choose');
        await wrapper.get('.next').trigger('click');
        assert.equal(wrapper.vm.steps.current.value, 'choose');
        wrapper.unmount();
    });

    test('the same predicate answers the button and the move', async () => {
        // Two predicates drift: the button enables while the move refuses, or
        // the reverse, and the user is left pressing something inert. A ref,
        // because that is what the wizard's guard reads — a plain variable
        // would only test the caching of this test's own closure.
        const open = ref(false);
        const wrapper = mountHost(() => open.value);
        assert.equal(wrapper.vm.steps.canAdvance.value, false);
        assert.equal(wrapper.vm.steps.next(), false);

        open.value = true;
        await nextTick();
        assert.equal(wrapper.vm.steps.canAdvance.value, true);
        assert.equal(wrapper.vm.steps.next(), true);
        assert.equal(wrapper.vm.steps.current.value, 'preview');
        wrapper.unmount();
    });
});

describe('focus follows the step', () => {
    test('advancing puts focus on the new heading', async () => {
        const wrapper = mountHost();
        const heading = wrapper.get('h3').element;
        assert.notEqual(document.activeElement, heading);

        await wrapper.get('.next').trigger('click');
        await nextTick();
        assert.equal(document.activeElement, heading);
        assert.equal(heading.textContent, 'step: preview');
        wrapper.unmount();
    });

    test('going back puts focus on the heading too', async () => {
        const wrapper = mountHost();
        await wrapper.get('.next').trigger('click');
        await nextTick();
        document.activeElement.blur();

        await wrapper.get('.back').trigger('click');
        await nextTick();
        assert.equal(document.activeElement, wrapper.get('h3').element);
        wrapper.unmount();
    });

    test('a refused move does not move focus', async () => {
        const wrapper = mountHost((step) => step !== 'choose');
        await wrapper.get('.next').trigger('click');
        await nextTick();
        assert.notEqual(document.activeElement, wrapper.get('h3').element);
        wrapper.unmount();
    });

    test('the heading is focusable without joining the tab order', () => {
        const wrapper = mountHost();
        assert.equal(wrapper.get('h3').attributes('tabindex'), '-1');
        wrapper.unmount();
    });
});

describe('a wizard with no steps is a mistake, not an empty wizard', () => {
    test('it refuses to be built', () => {
        assert.throws(() => useSteps({ steps: [] }), /at least one step/);
    });
});
