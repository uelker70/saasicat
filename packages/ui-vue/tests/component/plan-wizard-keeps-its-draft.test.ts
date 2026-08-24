// The plan wizard's three steps, and the one property the route split threatens.
//
// Editor and review are two steps of one wizard, and the draft between them is
// NOT saved: the editor hands a form payload forward, the review renders it,
// and going back returns to a form that still holds every value. Nothing has
// reached the server at either point — that is the purpose of the step, to look
// at the impact before committing to it.
//
// 4.11 made those steps their own routes. Route navigation discards a page's
// component state, so the draft now lives in `providePlanWizard()`, provided by
// the plans route the two are children of. This file is what holds that
// arrangement to its promise: it drives the STEPS, not the page that used to
// contain them, because the handlers inside that page are no longer what the
// operator reaches.

import { afterEach, describe, expect, test } from 'vitest';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';

import PlanReviewPage from '../../src/pages/PlanReviewPage.vue';
import PlanVersionEditorPage from '../../src/pages/PlanVersionEditorPage.vue';
import { providePlanArea } from '../../src/features/plan/plan-area-context.js';
import { providePlanWizard, type PlanWizardState } from '../../src/vue/plan-wizard.js';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';

const PLAN = { id: 'plan-1', planKey: 'PRO', label: 'Pro', description: null, sortOrder: 1 };

const LIVE_VERSION = {
    id: 'v-1',
    planId: 'PRO',
    version: 1,
    features: ['export'],
    bundles: [],
    quotas: { notes: 100 },
    monthlyNet: '10.00',
    yearlyNet: '100.00',
    marketed: true,
    publishedAt: '2026-01-01T00:00:00.000Z',
    supersededAt: null,
    publishedChanges: null,
    changeNote: 'v1',
    nonRegressive: true,
    validFrom: null,
    validUntil: null,
    createdByUserId: null,
    publishedByUserId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
};

/** What the operator typed and has not saved. */
const EDITED = {
    version: 2,
    features: ['export', 'sso'],
    bundles: ['starter-pack'],
    quotas: { notes: 500 },
    monthlyNet: '19.00',
    yearlyNet: '190.00',
    changeNote: 'raise the note quota',
    marketed: true,
    validFrom: '2026-09-01',
    validUntil: null,
};

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

/**
 * Mounts a step the way the router does: inside a parent that provides the
 * wizard and the plan area, with nothing passed as a prop.
 *
 * The parent is what survives navigation between the two steps in the product,
 * so the fixture reproduces that rather than mounting a step in isolation —
 * a step on its own would start with an empty draft and prove nothing.
 */
function mountArea(outcome: { save?: boolean; publish?: boolean } = {}) {
    let wizard!: PlanWizardState;
    const saved: unknown[] = [];
    const published: Array<{ payload: unknown; editingId: string | null; options: unknown }> = [];

    const Host = defineComponent({
        props: { step: { type: String, required: true } },
        setup(props) {
            wizard = providePlanWizard();
            providePlanArea({
                plan: { value: PLAN } as never,
                versions: { value: [LIVE_VERSION] } as never,
                availableFeatures: { value: [] } as never,
                availableQuotas: { value: [] } as never,
                availableBundles: { value: [] } as never,
                featureRegistry: { value: {} } as never,
                tenantCounts: { value: { PRO: 3 } } as never,
                saving: { value: false } as never,
                publishing: { value: false } as never,
                saveError: { value: null } as never,
                // The real ones report whether the write happened; the steps
                // are only allowed to leave when it did.
                saveDraft: async (payload) => {
                    saved.push(payload);
                    return outcome.save ?? true;
                },
                publishDraft: async (payload, editingId, options) => {
                    published.push({ payload, editingId, options });
                    return outcome.publish ?? true;
                },
            });
            return () => h(props.step === 'edit' ? PlanVersionEditorPage : PlanReviewPage);
        },
    });

    const router = createRouter({
        history: createMemoryHistory(),
        routes: [{ path: '/:rest(.*)', component: { template: '<div />' } }],
    });

    function render(step: 'edit' | 'review') {
        const wrapper = mountWithQuasar(Host, {
            props: { step },
            global: { plugins: [router] },
        });
        mounted.push(wrapper);
        // The STEP's vm, not the host's: the host only exists to provide what
        // the router's parent route provides in the product.
        const page = wrapper.findComponent(
            step === 'edit' ? PlanVersionEditorPage : PlanReviewPage,
        );
        return { wrapper, page };
    }

    return {
        render,
        get wizard() {
            return wizard;
        },
        saved,
        published,
        router,
    };
}

describe('the wizard carries its unsaved draft across the two routes', () => {
    test('the editor writes what was typed into the wizard, not into the page', async () => {
        const area = mountArea();
        const { page: editor } = area.render('edit');
        area.wizard.editing.value = { editingId: null, initialForm: { ...EDITED } };
        await editor.vm.$nextTick();

        // The editor's "next" is what moves the wizard on. Driven directly
        // because what this file measures is the state that survives the step,
        // not how a value is typed into a 1,600-line split view.
        (editor.vm as unknown as { onNext: (p: typeof EDITED) => void }).onNext(EDITED);

        expect(area.wizard.editing.value?.initialForm.quotas).toEqual({ notes: 500 });
        expect(area.wizard.editing.value?.initialForm.monthlyNet).toBe('19.00');
    });

    test('the review renders the unsaved values, not the published version', async () => {
        const area = mountArea();
        const { page: review } = area.render('review');
        area.wizard.editing.value = { editingId: null, initialForm: { ...EDITED } };
        await review.vm.$nextTick();

        const version = (review.vm as unknown as { reviewVersion: Record<string, unknown> })
            .reviewVersion;
        // `notes: 100` here would mean the review read the server's version and
        // would publish something the operator never saw.
        expect(version.quotas).toEqual({ notes: 500 });
        expect(version.monthlyNet).toBe('19.00');
        expect(version.changeNote).toBe('raise the note quota');
        expect(version.publishedAt).toBeNull();
        // The editor derives these from the features; the review used to replace
        // them with an empty list, so a publish dropped every selected bundle.
        expect(version.bundles).toEqual(['starter-pack']);
    });

    test('the draft outlives the navigation between the two steps', async () => {
        const area = mountArea();
        const { wrapper: editorWrapper, page: editor } = area.render('edit');
        area.wizard.editing.value = { editingId: null, initialForm: { ...EDITED } };
        (editor.vm as unknown as { onNext: (p: typeof EDITED) => void }).onNext(EDITED);

        // Unmounting the editor is what navigating away does. The draft has to
        // be somewhere else by then — this is the assertion the whole split
        // rests on.
        editorWrapper.unmount();

        expect(area.wizard.editing.value?.initialForm.quotas).toEqual({ notes: 500 });
        expect(area.wizard.editing.value?.initialForm.features).toEqual(['export', 'sso']);
    });

    test('cancelling clears the draft rather than leaving it for the next plan', async () => {
        const area = mountArea();
        const { page: editor } = area.render('edit');
        area.wizard.editing.value = { editingId: null, initialForm: { ...EDITED } };
        await editor.vm.$nextTick();

        (editor.vm as unknown as { onCancel: () => void }).onCancel();

        expect(area.wizard.editing.value).toBeNull();
    });
});

describe('a step leaves the wizard only when the write happened', () => {
    // Three defects with one shape: the step reset the wizard and navigated
    // before knowing whether anything had been written. A rejected save, and a
    // publish that never ran, both looked exactly like success — the form was
    // gone, the route had changed, and the error the page had recorded was
    // rendered by a page nobody was on any more.

    test('a refused save keeps the draft and stays on the step', async () => {
        const area = mountArea({ save: false });
        const { page: review } = area.render('review');
        area.wizard.editing.value = { editingId: null, initialForm: { ...EDITED } };
        await review.vm.$nextTick();

        await (review.vm as unknown as { onSaveAndExit: () => Promise<void> }).onSaveAndExit();

        expect(area.saved).toHaveLength(1);
        expect(area.wizard.editing.value?.initialForm.quotas).toEqual({ notes: 500 });
        expect(area.router.currentRoute.value.fullPath).not.toBe('/admin/plans');
    });

    test('a save that succeeds clears the draft', async () => {
        const area = mountArea({ save: true });
        const { page: review } = area.render('review');
        area.wizard.editing.value = { editingId: null, initialForm: { ...EDITED } };
        await review.vm.$nextTick();

        await (review.vm as unknown as { onSaveAndExit: () => Promise<void> }).onSaveAndExit();

        expect(area.wizard.editing.value).toBeNull();
    });

    test('publish carries the form and the checklist flags', async () => {
        const area = mountArea();
        const { page: review } = area.render('review');
        area.wizard.editing.value = { editingId: 'draft-7', initialForm: { ...EDITED } };
        await review.vm.$nextTick();

        await (
            review.vm as unknown as {
                onPublish: (p: {
                    forceRegressive: boolean;
                    allowZeroPrice: boolean;
                }) => Promise<void>;
            }
        ).onPublish({ forceRegressive: true, allowZeroPrice: false });

        expect(area.published).toHaveLength(1);
        // The operator's unsaved numbers, not the page's copy of them: the
        // page's copy is written by a SAVE, so publishing without one used to
        // publish nothing while the step behaved as though it had.
        expect(area.published[0]?.payload).toMatchObject({
            quotas: { notes: 500 },
            monthlyNet: '19.00',
            bundles: ['starter-pack'],
        });
        expect(area.published[0]?.editingId).toBe('draft-7');
        // Ticked in the checklist and dropped on the way out before this.
        expect(area.published[0]?.options).toEqual({
            forceRegressive: true,
            allowZeroPrice: false,
        });
    });

    test('a publish that does not go through keeps the draft', async () => {
        const area = mountArea({ publish: false });
        const { page: review } = area.render('review');
        area.wizard.editing.value = { editingId: null, initialForm: { ...EDITED } };
        await review.vm.$nextTick();

        await (
            review.vm as unknown as {
                onPublish: (p: {
                    forceRegressive: boolean;
                    allowZeroPrice: boolean;
                }) => Promise<void>;
            }
        ).onPublish({ forceRegressive: false, allowZeroPrice: false });

        expect(area.wizard.editing.value?.initialForm.quotas).toEqual({ notes: 500 });
    });
});
