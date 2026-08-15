import { describe, expect, test } from 'vitest';
import { h } from 'vue';

import AdminAccordion from '../src/components/admin-page/AdminAccordion.vue';
import { mountWithQuasar } from './support/mount-with-quasar';

// The component exists for two claims, and neither is visible in a screenshot.
//
// The first is that the trigger is a real control. Four of the eight disclosure
// surfaces this replaces were a `<div>` with a click handler: no `tabindex`, no
// keyboard, and a screen reader announcing text where a button should be. A
// grep for `aria-expanded` across the whole package returned nothing at all.
//
// The second is structural, and it is the one a comment cannot enforce: the
// header's controls sit OUTSIDE the trigger. The discovery cards put a live
// status control inside a clickable header, and the only thing that kept
// approving a feature from also collapsing its card was an `@click.stop`
// somebody remembered to write. A slot that renders as a sibling cannot forget.
//
// Both are asserted by behaviour rather than by reading the source, because
// both are about what the browser does with the markup.

const mount = (props: Record<string, unknown> = {}, slots: Record<string, unknown> = {}) =>
    mountWithQuasar(AdminAccordion, {
        props: { open: false, ...props },
        slots: { header: () => 'Header', default: () => 'Body', ...slots },
    });

describe('the trigger is a control, not a div that listens', () => {
    test('it is a button, and one that does not submit', () => {
        const trigger = mount().find('.sa-accordion__trigger');
        expect(trigger.element.tagName).toBe('BUTTON');
        // Without `type`, a button inside a form submits it. Every one of these
        // sits inside a page that may grow a form around it.
        expect(trigger.attributes('type')).toBe('button');
    });

    test('aria-expanded says which state it is in', () => {
        expect(
            mount({ open: false }).find('.sa-accordion__trigger').attributes('aria-expanded'),
        ).toBe('false');
        expect(
            mount({ open: true }).find('.sa-accordion__trigger').attributes('aria-expanded'),
        ).toBe('true');
    });

    test('aria-controls names the body that is actually there', () => {
        const wrapper = mount({ open: true });
        const controls = wrapper.find('.sa-accordion__trigger').attributes('aria-controls');
        expect(controls).toBeTruthy();
        expect(wrapper.find('.sa-accordion__body').attributes('id')).toBe(controls);
    });

    test('the body names the trigger back', () => {
        const wrapper = mount({ open: true });
        expect(wrapper.find('.sa-accordion__body').attributes('aria-labelledby')).toBe(
            wrapper.find('.sa-accordion__trigger').attributes('id'),
        );
        expect(wrapper.find('.sa-accordion__body').attributes('role')).toBe('region');
    });

    test('two instances on ONE page do not share their ids', () => {
        // `aria-controls` pointing at another card's body is worse than none,
        // and an accordion is by nature rendered many times on one page.
        //
        // Both in a single parent, deliberately. The first version of this
        // mounted twice and compared — and failed, because `useId` counts per
        // APP and each mount makes its own. That measured the harness rather
        // than the component: in a page there is one app, and the collision it
        // reported cannot occur.
        const wrapper = mountWithQuasar(
            {
                components: { AdminAccordion },
                template: `
                    <div>
                        <AdminAccordion :open="true"><template #header>A</template>a</AdminAccordion>
                        <AdminAccordion :open="true"><template #header>B</template>b</AdminAccordion>
                    </div>`,
            },
            {},
        );
        const [first, second] = wrapper.findAll('.sa-accordion__body');
        expect(first.attributes('id')).toBeTruthy();
        expect(first.attributes('id')).not.toBe(second.attributes('id'));
    });

    test('a disabled row is inert and says so', () => {
        const trigger = mount({ disabled: true }).find('.sa-accordion__trigger');
        expect(trigger.attributes('disabled')).toBeDefined();
    });
});

describe('the page owns the state', () => {
    test('the body is absent while closed, not merely hidden', () => {
        expect(mount({ open: false }).find('.sa-accordion__body').exists()).toBe(false);
        expect(mount({ open: true }).find('.sa-accordion__body').exists()).toBe(true);
    });

    test('a click asks for the opposite, and changes nothing by itself', async () => {
        const wrapper = mount({ open: false });
        await wrapper.find('.sa-accordion__trigger').trigger('click');
        expect(wrapper.emitted('update:open')).toEqual([[true]]);
        // Still closed: the bundle list ties opening one row to closing another
        // and loading that bundle's versions, so a component that flipped its
        // own boolean would fight it. Four more take the state from outside
        // without that coupling, and lose nothing by the arrangement.
        expect(wrapper.find('.sa-accordion__body').exists()).toBe(false);
    });

    test('an open row asks to close', async () => {
        const wrapper = mount({ open: true });
        await wrapper.find('.sa-accordion__trigger').trigger('click');
        expect(wrapper.emitted('update:open')).toEqual([[false]]);
    });
});

describe('a control in the header is not part of the trigger', () => {
    const withAction = () =>
        mount({}, { 'header-actions': () => h('button', { class: 'probe', type: 'button' }, 'x') });

    test('it renders outside the button', () => {
        const wrapper = withAction();
        expect(wrapper.find('.probe').exists()).toBe(true);
        // Nested interactive content inside a `<button>` is not valid HTML, so
        // "outside" is not a preference — it is the only arrangement whose
        // behaviour is defined.
        expect(wrapper.find('.sa-accordion__trigger .probe').exists()).toBe(false);
    });

    test('clicking it does not toggle the row', async () => {
        // The claim the `@click.stop` used to carry. Here it is the markup.
        const wrapper = withAction();
        await wrapper.find('.probe').trigger('click');
        expect(wrapper.emitted('update:open')).toBeUndefined();
    });

    test('nothing is rendered for it when the slot is unused', () => {
        expect(mount().find('.sa-accordion__actions').exists()).toBe(false);
    });
});

describe('the badge is the component, the glyph is the page', () => {
    // Three surfaces drew this three ways — a 34px accent-tinted square, a bare
    // 22px glyph, and a bare 20px glyph coloured through a Quasar PALETTE prop
    // (`color="negative"`, which reaches past the role layer entirely). The
    // same kind of row did not look like the same kind of row.
    const withMark = (props = {}) => mount(props, { mark: () => h('i', { class: 'glyph' }) });

    test('the page supplies a glyph and the component supplies the frame', () => {
        const wrapper = withMark();
        expect(wrapper.find('.sa-accordion__mark .glyph').exists()).toBe(true);
        expect(wrapper.find('.sa-accordion__mark').classes()).toContain(
            'sa-accordion__mark--accent',
        );
    });

    test('a row whose state the badge should report says so', () => {
        expect(withMark({ markTone: 'negative' }).find('.sa-accordion__mark').classes()).toContain(
            'sa-accordion__mark--negative',
        );
    });

    test('no badge is drawn for a row that has no glyph', () => {
        // Otherwise every unmarked row would gain an empty tinted square.
        expect(mount().find('.sa-accordion__mark').exists()).toBe(false);
    });

    test('the badge sits inside the trigger, unlike the actions', () => {
        // It identifies the row rather than doing anything, so clicking it
        // should open the row like the rest of the header does.
        expect(withMark().find('.sa-accordion__trigger .sa-accordion__mark').exists()).toBe(true);
    });
});
