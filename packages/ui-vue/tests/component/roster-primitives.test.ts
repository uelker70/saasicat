import { afterEach, describe, expect, test } from 'vitest';
import { nextTick } from 'vue';

import AdminBanner from '../../src/ui/feedback/AdminBanner.vue';
import AdminErrorBanner from '../../src/ui/feedback/AdminErrorBanner.vue';
import AdminConfirmDialog from '../../src/ui/overlay/AdminConfirmDialog.vue';
import AdminFormDialog from '../../src/ui/overlay/AdminFormDialog.vue';
import AdminEmptyState from '../../src/ui/feedback/AdminEmptyState.vue';
import AdminField from '../../src/ui/page/AdminField.vue';
import AdminFieldGrid from '../../src/ui/page/AdminFieldGrid.vue';
import AdminToolbar from '../../src/ui/page/AdminToolbar.vue';
import AdminStatusPill from '../../src/ui/data/AdminStatusPill.vue';
import AdminRowActions from '../../src/ui/data/AdminRowActions.vue';
import { flushPromises } from '@vue/test-utils';

import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';

// Dialogs teleport into `document.body` and stay there until unmounted. Without
// this, the second test in a block queries the FIRST test's buttons — which is
// how three assertions here passed against a dialog that was no longer the one
// under test.
const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

/** The confirming button of the dialog currently on screen. */
function primaryButton(): HTMLButtonElement {
    const buttons = document.querySelectorAll('.sa-dialog__actions button');
    expect(buttons).toHaveLength(2);
    return buttons[1] as HTMLButtonElement;
}

// The claims the roster primitives make that a screenshot cannot show, and that
// the source scan in admin-page-shell.test.ts cannot reach either — these are
// about what happens when a thing is clicked, fails, or reopened.

describe('AdminBanner carries meaning without relying on colour', () => {
    test('each tone brings its own icon, so the shape differs before the hue does', () => {
        const icons = (['info', 'positive', 'warning', 'negative'] as const).map((tone) => {
            const wrapper = mountWithQuasar(AdminBanner, { props: { tone } });
            return wrapper.find('.sa-banner__icon').text();
        });
        expect(new Set(icons).size).toBe(4);
    });

    test('an explicit `icon: false` renders none — for a body that carries its own', () => {
        const wrapper = mountWithQuasar(AdminBanner, { props: { tone: 'warning', icon: false } });
        expect(wrapper.find('.sa-banner__icon').exists()).toBe(false);
    });

    test('the close button is only there when the caller asked for it', () => {
        const plain = mountWithQuasar(AdminBanner, { props: {} });
        expect(plain.find('.sa-banner__close').exists()).toBe(false);
        const dismissible = mountWithQuasar(AdminBanner, { props: { dismissible: true } });
        expect(dismissible.find('.sa-banner__close').exists()).toBe(true);
    });
});

describe('AdminErrorBanner is bound unconditionally and decides for itself', () => {
    test('a null error renders nothing at all — no empty box above the body', () => {
        const wrapper = mountWithQuasar(AdminErrorBanner, { props: { error: null } });
        expect(wrapper.find('.sa-banner').exists()).toBe(false);
    });

    test('a rejection becomes a sentence, not "[object Object]"', () => {
        const wrapper = mountWithQuasar(AdminErrorBanner, {
            props: { error: new Error('Plan is still published') },
        });
        expect(wrapper.text()).toContain('Plan is still published');
    });

    test('retry is offered only when there is something to retry', () => {
        const without = mountWithQuasar(AdminErrorBanner, { props: { error: new Error('x') } });
        expect(without.findAll('button')).toHaveLength(0);
        let calls = 0;
        const withRetry = mountWithQuasar(AdminErrorBanner, {
            props: { error: new Error('x'), retry: () => void calls++ },
        });
        expect(withRetry.findAll('button')).toHaveLength(1);
    });
});

describe('AdminFormDialog owns the submit lifecycle', () => {
    async function openWith(submit: () => Promise<unknown>) {
        const wrapper = mountWithQuasar(AdminFormDialog, {
            props: { modelValue: true, title: 'Create plan', submit },
            attachTo: document.body,
        });
        mounted.push(wrapper);
        // The dialog reaches its portal a tick after mounting; querying before
        // that finds an empty body and every assertion below is vacuous.
        await nextTick();
        await nextTick();
        return wrapper;
    }

    test('a failed submit keeps the dialog open and shows the reason', async () => {
        const wrapper = await openWith(() => Promise.reject(new Error('Key already taken')));
        primaryButton().click();
        await flushPromises();
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
        expect(document.querySelector('.sa-dialog')?.textContent).toContain('Key already taken');
    });

    test('a successful submit closes it and says so once', async () => {
        const wrapper = await openWith(() => Promise.resolve());
        primaryButton().click();
        await flushPromises();
        expect(wrapper.emitted('submitted')).toHaveLength(1);
        expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false]);
    });
});

describe('AdminConfirmDialog escalates the irreversible ones', () => {
    async function mount(props: Record<string, unknown>) {
        const wrapper = mountWithQuasar(AdminConfirmDialog, {
            props: {
                modelValue: true,
                title: 'Delete tenant',
                confirm: () => Promise.resolve(),
                ...props,
            },
            attachTo: document.body,
        });
        mounted.push(wrapper);
        await nextTick();
        await nextTick();
        return wrapper;
    }

    test('typing the wrong name leaves the confirming button unusable', async () => {
        const wrapper = await mount({ requireTyped: { label: 'Name', expected: 'Acme' } });
        expect(primaryButton().disabled).toBe(true);
        await wrapper.findComponent({ name: 'QInput' }).setValue('acme');
        await nextTick();
        expect(primaryButton().disabled).toBe(true);
    });

    test('the typed answer does not survive a reopen', async () => {
        const wrapper = await mount({ requireTyped: { label: 'Name', expected: 'Acme' } });
        await wrapper.findComponent({ name: 'QInput' }).setValue('Acme');
        await nextTick();
        expect(primaryButton().disabled).toBe(false);
        await wrapper.setProps({ modelValue: false });
        await wrapper.setProps({ modelValue: true });
        await nextTick();
        expect(primaryButton().disabled).toBe(true);
    });
});

describe('AdminRowActions', () => {
    test('a hidden action is not rendered — a row shows what it is eligible for', () => {
        const wrapper = mountWithQuasar(AdminRowActions, {
            props: {
                actions: [
                    { key: 'edit', label: 'Edit' },
                    { key: 'delete', label: 'Delete', tone: 'danger', hidden: true },
                ],
            },
        });
        expect(wrapper.findAll('button')).toHaveLength(1);
        expect(wrapper.text()).not.toContain('Delete');
    });

    test('a disabled action stays visible, so the row does not change shape', () => {
        const wrapper = mountWithQuasar(AdminRowActions, {
            props: { actions: [{ key: 'delete', label: 'Delete', disabled: true }] },
        });
        expect(wrapper.findAll('button')).toHaveLength(1);
    });
});

describe('AdminField associates what it shows', () => {
    test('the error is announced, and it replaces the hint rather than joining it', async () => {
        const wrapper = mountWithQuasar(AdminField, {
            props: { label: 'Key', hint: 'Lowercase only' },
        });
        expect(wrapper.find('.sa-field__hint').exists()).toBe(true);
        await wrapper.setProps({ error: 'Already taken' });
        expect(wrapper.find('.sa-field__hint').exists()).toBe(false);
        const error = wrapper.find('.sa-field__error');
        expect(error.attributes('role')).toBe('alert');
        expect(error.attributes('id')).toBeTruthy();
    });

    test('the slot is handed the id to point `aria-describedby` at', () => {
        const seen: (string | undefined)[] = [];
        mountWithQuasar(AdminField, {
            props: { label: 'Key', error: 'Already taken' },
            slots: {
                default: (scope: { describedBy?: string }) => {
                    seen.push(scope.describedBy);
                    return 'control';
                },
            },
        });
        expect(seen[0]).toBeTruthy();
    });
});

// Four primitives the roster ships that no page consumes yet. AP2 names this
// exact risk — "a primitive without a consumer is the promise that later rides
// along unchecked" — so each is pinned by the claim that would otherwise be
// unverified, and `AdminToolbar` and `AdminFieldGrid` had no test at all.

describe('AdminToolbar', () => {
    test('the end group is pushed away from the start one, not centred', () => {
        const wrapper = mountWithQuasar(AdminToolbar, {
            slots: { start: () => 'left', end: () => 'right' },
        });
        expect(wrapper.attributes('data-align')).toBe('between');
        expect(wrapper.find('.sa-toolbar__end').exists()).toBe(true);
    });

    test('with no end content there is no empty end group to space against', () => {
        const wrapper = mountWithQuasar(AdminToolbar, { slots: { default: () => 'only' } });
        expect(wrapper.find('.sa-toolbar__end').exists()).toBe(false);
        expect(wrapper.text()).toContain('only');
    });

    test('sticky is opt-in — a toolbar that follows the scroll is a decision', () => {
        expect(mountWithQuasar(AdminToolbar).attributes('data-sticky')).toBeUndefined();
        expect(
            mountWithQuasar(AdminToolbar, { props: { sticky: true } }).attributes('data-sticky'),
        ).toBe('');
    });
});

// @requirement SC-UI-012 — The interface works on desktop, tablet and phone
describe('AdminFieldGrid', () => {
    test('the column count reaches the DOM, because the layout is CSS', () => {
        expect(mountWithQuasar(AdminFieldGrid).attributes('data-columns')).toBe('2');
        expect(
            mountWithQuasar(AdminFieldGrid, { props: { columns: 3 } }).attributes('data-columns'),
        ).toBe('3');
    });

    test('a field carries its span, so one wide input can sit in a narrow grid', () => {
        const wrapper = mountWithQuasar(AdminField, {
            props: { label: 'Description', span: 'full' },
        });
        expect(wrapper.attributes('data-span')).toBe('full');
    });
});

describe('AdminEmptyState', () => {
    test('the title is the message; description and actions are optional', () => {
        const bare = mountWithQuasar(AdminEmptyState, { props: { title: 'No plans yet' } });
        expect(bare.text()).toContain('No plans yet');
        expect(bare.find('.sa-empty__body').exists()).toBe(false);
        expect(bare.find('.sa-empty__actions').exists()).toBe(false);
    });

    test('inline and block are different treatments, not the same one twice', () => {
        expect(
            mountWithQuasar(AdminEmptyState, { props: { title: 'x' } }).attributes('data-size'),
        ).toBe('block');
        expect(
            mountWithQuasar(AdminEmptyState, {
                props: { title: 'x', size: 'inline' },
            }).attributes('data-size'),
        ).toBe('inline');
    });
});

describe('AdminStatusPill', () => {
    test('the tone is a class, so the theme decides what it looks like', () => {
        const wrapper = mountWithQuasar(AdminStatusPill, {
            props: { label: 'Active', tone: 'positive' },
        });
        expect(wrapper.classes()).toContain('sa-pill--positive');
        expect(wrapper.classes()).toContain('sa-pill--soft');
        expect(wrapper.text()).toContain('Active');
    });

    test('the label is always there — colour never carries the status alone', () => {
        const wrapper = mountWithQuasar(AdminStatusPill, {
            props: { label: 'Suspended', tone: 'negative', icon: 'block' },
        });
        expect(wrapper.text()).toContain('Suspended');
        expect(wrapper.find('.sa-pill__icon').attributes('aria-hidden')).toBe('true');
    });
});
