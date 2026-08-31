// An action bar belongs to the object it acts on.
//
// The bundle detail panel edits two objects — the bundle (label, icon,
// translations) and the selected version (features, quotas, pricing) — and it
// used to present four action clusters in three places: master-data save at the
// foot of the left column, discard in the status banner at the top right,
// save/reset at the foot of the editor, and a full-width footer pairing
// "publish this version" with "soft-delete bundle".
//
// The last one is the reason this exists. One releases a draft; the other
// destroys the bundle and every version it has. They sat as peers, and
// soft-delete sat in the same corner as save, about forty pixels below it.
//
// Discard stays where it was, in the status banner: it reads as part of the
// draft's own state rather than as a step in the editing flow.
//
// These tests assert the arrangement rather than the pixels: which actions
// share a container, and which do not.

// @requirement SC-UI-010 — An action sits with the object it acts on

import { afterEach, describe, expect, test, vi } from 'vitest';

import BundlesPage from '../../src/pages/BundlesPage.vue';
import {
    SUPER_ADMIN_BRAND_KEY,
    SUPER_ADMIN_ENDPOINTS_KEY,
    SUPER_ADMIN_HTTP_KEY,
} from '../../src/vue/super-admin-context.js';
import { SUPER_ADMIN_CONFIRM_KEY } from '../../src/vue/ui-confirm.js';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';
import { provideStubResources } from './support/stub-resources.js';

const BUNDLE = {
    id: 'b-1',
    bundleKey: 'extra',
    label: 'Extra',
    description: null,
    icon: null,
    sortOrder: 0,
    i18n: {},
    createdAt: '2026-01-15T12:00:00.000Z',
    updatedAt: '2026-01-15T12:00:00.000Z',
    deletedAt: null,
};

/** A draft: the only state in which all three version actions are offered. */
const DRAFT = {
    id: 'v-2',
    bundleId: 'b-1',
    bundleKey: 'extra',
    label: 'Extra',
    version: 2,
    baseVersionId: null,
    publishedAt: null,
    supersededAt: null,
    publishedChanges: null,
    changeNote: '',
    nonRegressive: true,
    validFrom: null,
    validUntil: null,
    features: ['export'],
    quotas: {},
    compatibility: {},
    pricingOverrides: [],
    monthlyNet: '9.00',
    yearlyNet: null,
    marketed: true,
    createdByUserId: null,
    publishedByUserId: null,
    createdAt: '2026-01-15T12:00:00.000Z',
    updatedAt: '2026-01-15T12:00:00.000Z',
};

const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

function mountPage(confirmPort?: unknown) {
    const wrapper = mountWithQuasar(BundlesPage as never, {
        global: {
            provide: {
                [SUPER_ADMIN_BRAND_KEY as symbol]: { tag: 'SuperAdmin', name: 'T', logoText: 'T' },
                [SUPER_ADMIN_ENDPOINTS_KEY as symbol]: {
                    apiBase: '/api/admin',
                    publicBootEndpoint: '/api/admin/boot',
                    manifestEndpoint: '/api/admin/manifest',
                },
                [SUPER_ADMIN_HTTP_KEY as symbol]: async () => ({
                    status: 200,
                    headers: { get: () => null },
                    json: async () => ({}),
                    text: async () => '',
                }),
                ...(confirmPort ? { [SUPER_ADMIN_CONFIRM_KEY as symbol]: confirmPort } : {}),
                ...provideStubResources({
                    bundles: {
                        list: async () => [BUNDLE],
                        update: async () => BUNDLE,
                        softDelete: async () => undefined,
                        create: async () => BUNDLE,
                    },
                    bundleVersions: {
                        listForBundle: async () => [DRAFT],
                        updateDraft: async () => ({ warnings: [] }),
                    },
                    catalog: { features: async () => [], quotas: async () => [] },
                    plans: { list: async () => [] },
                    planVersions: { listForPlan: async () => [] },
                    discovery: { read: async () => ({ status: 'unchanged' }) },
                } as never),
            },
        },
    });
    mounted.push(wrapper);
    return wrapper;
}

async function settle(): Promise<void> {
    for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

async function openTheBundle(wrapper: ReturnType<typeof mountPage>) {
    await settle();
    await (wrapper.vm as unknown as { toggle: (b: unknown) => Promise<void> }).toggle(BUNDLE);
    await settle();
}

const labelsIn = (root: Element | null): string[] =>
    root ? [...root.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '') : [];

describe('the version keeps its actions together', () => {
    test('save and publish share one bar', async () => {
        const wrapper = mountPage();
        await openTheBundle(wrapper);

        const bar = wrapper.element.querySelector('.bve-actions');
        expect(bar, 'the version editor has no action bar').not.toBeNull();

        const labels = labelsIn(bar).join(' | ');
        // English: the component suite runs on the default locale.
        expect(labels).toContain('Save version');
        expect(labels).toContain('Publish');
    });

    test('discard stays with the draft state that offers it', async () => {
        // Deliberately NOT in the action bar: discarding is something you do to
        // a draft because it is a draft, and the banner is where that is said.
        const wrapper = mountPage();
        await openTheBundle(wrapper);

        const banner = wrapper.element.querySelector('.bv-status-banner');
        expect(
            banner,
            'the draft banner is not rendered — this case proves nothing',
        ).not.toBeNull();
        expect(labelsIn(banner).join(' | ')).toContain('Discard');
        expect(labelsIn(wrapper.element.querySelector('.bve-actions')).join(' | ')).not.toContain(
            'Discard',
        );
    });

    test('nothing spans both columns any more', async () => {
        // The old footer put a version action and a bundle-wide deletion side by
        // side because it belonged to neither column.
        const wrapper = mountPage();
        await openTheBundle(wrapper);
        expect(wrapper.element.querySelector('.sa-bd-version-actions')).toBeNull();
    });
});

describe('the bundle keeps its own', () => {
    test('soft-delete is not among the version actions', async () => {
        const wrapper = mountPage();
        await openTheBundle(wrapper);

        const bar = wrapper.element.querySelector('.bve-actions');
        expect(labelsIn(bar).join(' | ').toLowerCase()).not.toContain('soft');
    });

    test('it sits in the card header, named for a reader who cannot see icons', async () => {
        const wrapper = mountPage();
        await settle();
        const button = wrapper.element.querySelector('.sa-bd-card__delete');
        expect(button, 'the card header offers no delete').not.toBeNull();
        // Icon-only: the accessible name is the only name it has.
        expect(button?.getAttribute('aria-label')).toBeTruthy();
    });

    test('it is not a button inside a button', async () => {
        // `AdminAccordion` renders its `header` slot INSIDE the disclosure
        // `<button>`. A control placed there is interactive content nested in a
        // button: invalid markup, and neither a keyboard nor a screen reader
        // can tell toggling from deleting. `@click.stop` — which is what this
        // first shipped with — suppresses the toggle and none of the rest.
        const wrapper = mountPage(async () => ({ ok: false }));
        await settle();

        const remove = wrapper.element.querySelector('.sa-bd-card__delete')!;
        expect(remove.closest('button')).toBe(remove);
    });

    test('deleting does not also expand the row it removes', async () => {
        // Which follows from the slot rather than from a modifier: the actions
        // slot is a sibling of the trigger, so the click never reaches it.
        const wrapper = mountPage(async () => ({ ok: false }));
        await settle();
        const page = wrapper.vm as unknown as { openKey: string | null };
        expect(page.openKey).toBeNull();

        await wrapper.find('.sa-bd-card__delete').trigger('click');
        await settle();
        expect(page.openKey).toBeNull();
    });
});

describe('deleting asks through the platform, not through the browser', () => {
    test('the confirm port decides, and window.confirm is never called', async () => {
        // `window.confirm` cannot be themed and looks like the browser asking
        // rather than the application — the wrong impression for the one dialog
        // where a reader should slow down. Four other pages already use the port.
        const native = vi.spyOn(window, 'confirm').mockReturnValue(true);
        const asked: Array<{ message?: string }> = [];
        const wrapper = mountPage(async (request: { message?: string }) => {
            asked.push(request);
            return { ok: false };
        });
        await openTheBundle(wrapper);

        await (
            wrapper.vm as unknown as { confirmDelete: (b: unknown) => Promise<void> }
        ).confirmDelete(BUNDLE);

        expect(native).not.toHaveBeenCalled();
        expect(asked.length).toBe(1);
        expect(asked[0]?.message ?? '').toContain('Extra');
    });
});

describe('two forms in one panel say which one is waiting', () => {
    // The left column saves the bundle, the right one the version. Without a
    // signal, a reader who changed the label and the price presses one button
    // and believes both are saved. The dot and the disabled state are the same
    // fact told twice — once for the eye, once for the accessibility tree.
    //
    // Neither is rendered by any visual fixture: the fixture's bundle is
    // pristine, so `v-if="masterDataDirty"` is false and the baseline records
    // the clean state only. This is where the other half is checked.

    const saveButton = (wrapper: ReturnType<typeof mountPage>) =>
        wrapper.element.querySelector('.sa-bd-save') as HTMLButtonElement | null;

    test('a pristine form offers nothing to save', async () => {
        const wrapper = mountPage();
        await openTheBundle(wrapper);

        expect(wrapper.element.querySelector('.sa-bd-dirty')).toBeNull();
        expect(saveButton(wrapper)?.className).toContain('disabled');
    });

    test('an edit shows the marker and enables the button', async () => {
        const wrapper = mountPage();
        await openTheBundle(wrapper);

        (wrapper.vm as unknown as { editForm: { label: string } }).editForm.label = 'Extra Plus';
        await settle();

        const marker = wrapper.element.querySelector('.sa-bd-dirty');
        expect(marker, 'nothing marks the column as changed').not.toBeNull();
        // Icon-only marker: the name is what a screen reader gets.
        expect(marker?.getAttribute('aria-label')).toBeTruthy();
        expect(saveButton(wrapper)?.className).not.toContain('disabled');
    });
});
