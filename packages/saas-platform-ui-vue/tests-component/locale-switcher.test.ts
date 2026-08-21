// The switcher decides in its template whether to render at all, and that
// decision has already been a review finding once (#85): reading a missing
// `switcherEnabled` as "off" would make every switcher vanish after an upgrade,
// silently. Template logic like that is what the unit tests against `dist/`
// cannot reach.

import { afterEach, describe, expect, test } from 'vitest';
import { ref } from 'vue';

import LocaleSwitcher from '../src/ui/page/LocaleSwitcher.vue';
import { SUPER_ADMIN_I18N_KEY } from '../src/vue/use-super-admin-i18n.js';
import { mountWithQuasar } from './support/mount-with-quasar.js';

type I18nStub = Record<string, unknown>;

// QMenu teleports into `body` and nothing removes it on its own. Without this
// the next test reads leftover entries from the previous one and passes or
// fails for reasons of ordering.
const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

function mountSwitcher(i18n: I18nStub) {
    const wrapper = mountWithQuasar(LocaleSwitcher, {
        attachTo: document.body,
        global: { provide: { [SUPER_ADMIN_I18N_KEY as symbol]: i18n } },
    });
    mounted.push(wrapper);
    return wrapper;
}

/**
 * QMenu renders its content only once opened, and teleports it to `body` — so
 * the entries are unreachable through the wrapper and have to be read off the
 * document after a click.
 */
async function openMenu(wrapper: ReturnType<typeof mountSwitcher>): Promise<Element[]> {
    await wrapper.find('.sa-locale-switcher').trigger('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    return [...document.querySelectorAll('.sa-locale-switcher__list .q-item')];
}

function context(overrides: I18nStub = {}): I18nStub {
    return {
        locale: ref('de'),
        messages: ref({ shell: { header: { language: 'Sprache' } } }),
        intlLocale: ref('de-DE'),
        switcherEnabled: true,
        availableLocales: [
            { code: 'de', label: 'Deutsch' },
            { code: 'en', label: 'English' },
        ],
        ...overrides,
    };
}

/** The button's own caption, not the menu items that repeat the same words. */
function buttonLabel(wrapper: ReturnType<typeof mountSwitcher>): string {
    return wrapper.find('.sa-locale-switcher .q-btn__content').text();
}

describe('LocaleSwitcher visibility', () => {
    test('renders when the app offers several languages', () => {
        expect(mountSwitcher(context()).find('.sa-locale-switcher').exists()).toBe(true);
    });

    test('renders nothing when the app opted out', () => {
        const wrapper = mountSwitcher(context({ switcherEnabled: false }));
        expect(wrapper.find('.sa-locale-switcher').exists()).toBe(false);
    });

    test('a context from an older package version still shows it', () => {
        // No `switcherEnabled`, no `availableLocales` — the shape a pre-0.16
        // copy of this package provides through the shared Symbol.for key.
        // Chrome fails open rather than disappearing without a trace.
        const wrapper = mountSwitcher({
            locale: ref('de'),
            messages: ref({ shell: { header: { language: 'Sprache' } } }),
            intlLocale: ref('de-DE'),
        });
        expect(wrapper.find('.sa-locale-switcher').exists()).toBe(true);
    });
});

describe('LocaleSwitcher contents', () => {
    test('the button shows the active language by its own name', () => {
        expect(buttonLabel(mountSwitcher(context({ locale: ref('en') })))).toContain('English');
    });

    test('an app-supplied language is labelled from availableLocales', () => {
        const wrapper = mountSwitcher(
            context({ locale: ref('fr'), availableLocales: [{ code: 'fr', label: 'Français' }] }),
        );
        expect(buttonLabel(wrapper)).toContain('Français');
    });

    test('an unknown active locale falls back to its code instead of blanking', () => {
        expect(buttonLabel(mountSwitcher(context({ locale: ref('kl') })))).toContain('kl');
    });

    test('the accessible label comes from the catalog', () => {
        const wrapper = mountSwitcher(context());
        expect(wrapper.find('.sa-locale-switcher').attributes('aria-label')).toBe('Sprache');
    });

    test('every offered language becomes a menu entry', async () => {
        const wrapper = mountSwitcher(
            context({
                availableLocales: [
                    { code: 'de', label: 'Deutsch' },
                    { code: 'en', label: 'English' },
                    { code: 'fr', label: 'Français' },
                ],
            }),
        );
        const entries = await openMenu(wrapper);
        expect(entries).toHaveLength(3);
        expect(entries.map((e) => e.textContent).join(' ')).toContain('Français');
    });
});

describe('LocaleSwitcher selection', () => {
    test('picking an entry writes the shared locale', async () => {
        const locale = ref('de');
        const entries = await openMenu(mountSwitcher(context({ locale })));
        (entries[1] as HTMLElement).click();
        expect(locale.value).toBe('en');
    });

    test('only the active entry carries the check mark', async () => {
        const entries = await openMenu(mountSwitcher(context({ locale: ref('en') })));
        expect(entries[0].querySelector('.q-icon')).toBeNull();
        expect(entries[1].querySelector('.q-icon')).not.toBeNull();
    });
});
