// The theme switcher decides in its template whether to render at all, and it
// reads two contexts that a consumer app can supply from an OLDER copy of this
// package — the theme and the catalog both arrive through a `Symbol.for` key.
// Template logic like that is what the unit tests against `dist/` cannot reach.
//
// Every case provides its own theme context, deliberately and without
// exception. `useSaTheme()` falls back to a MODULE-LEVEL singleton, so a mount
// without a provider would share one `scheme` ref with every other isolated
// mount in this Vitest process — a case that picks 'dark' would then decide the
// outcome of the next file, and the leak reads exactly like a pass.

// @requirement SC-UI-016 — Light and dark are both shipped, and a person can pick

import { afterEach, describe, expect, test } from 'vitest';
import { computed, ref, type Ref } from 'vue';

import ThemeSwitcher from '../../src/ui/page/ThemeSwitcher.vue';
import { SA_THEME_KEY } from '../../src/vue/use-sa-theme.js';
import { SUPER_ADMIN_I18N_KEY } from '../../src/vue/use-super-admin-i18n.js';
import { mountWithQuasar } from '../../src/testing/mount-with-quasar.js';

type ThemeStub = Record<string, unknown>;
type I18nStub = Record<string, unknown>;

// QMenu teleports into `body` and nothing removes it on its own. Without this
// the next test reads leftover entries from the previous one and passes or
// fails for reasons of ordering.
const mounted: { unmount: () => void }[] = [];
afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount();
    document.body.innerHTML = '';
});

const THEME_MESSAGES = {
    label: 'Appearance',
    light: 'Light',
    dark: 'Dark',
    system: 'System',
};

function i18n(header: Record<string, unknown> = { theme: THEME_MESSAGES }): I18nStub {
    return {
        locale: ref('en'),
        messages: ref({ shell: { header } }),
        intlLocale: ref('en-GB'),
        switcherEnabled: true,
        availableLocales: [{ code: 'en', label: 'English' }],
    };
}

function theme(overrides: ThemeStub = {}): ThemeStub {
    const scheme = (overrides.scheme as Ref<string>) ?? ref('system');
    return {
        scheme,
        resolved: computed(() => (scheme.value === 'system' ? 'light' : scheme.value)),
        switcherEnabled: true,
        dispose: () => {},
        ...overrides,
    };
}

function mountSwitcher(themeStub: ThemeStub, i18nStub: I18nStub = i18n()) {
    const wrapper = mountWithQuasar(ThemeSwitcher, {
        attachTo: document.body,
        global: {
            provide: {
                [SA_THEME_KEY as symbol]: themeStub,
                [SUPER_ADMIN_I18N_KEY as symbol]: i18nStub,
            },
        },
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
    await wrapper.find('.sa-theme-switcher').trigger('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    return [...document.querySelectorAll('.sa-theme-switcher__list .q-item')];
}

/** The button's own caption, not the menu items that repeat the same words. */
function buttonLabel(wrapper: ReturnType<typeof mountSwitcher>): string {
    return wrapper.find('.sa-theme-switcher .q-btn__content').text();
}

describe('ThemeSwitcher visibility', () => {
    test('renders when the shell provides a theme', () => {
        expect(mountSwitcher(theme()).find('.sa-theme-switcher').exists()).toBe(true);
    });

    test('renders nothing when the app opted out', () => {
        const wrapper = mountSwitcher(theme({ switcherEnabled: false }));
        expect(wrapper.find('.sa-theme-switcher').exists()).toBe(false);
    });

    test('a context from an older package version still shows it', () => {
        // No `switcherEnabled` — the shape a copy of this package from before
        // the switcher existed provides through the shared `Symbol.for` key.
        // Chrome fails open rather than disappearing without a trace.
        const wrapper = mountSwitcher({
            scheme: ref('system'),
            resolved: computed(() => 'light'),
            dispose: () => {},
        });
        expect(wrapper.find('.sa-theme-switcher').exists()).toBe(true);
    });

    test('a catalog from an older package version renders instead of throwing', () => {
        // Same skew on the i18n side: `header.theme` did not exist before this
        // control did, and reading through it unguarded would replace a missing
        // word with a blank shell.
        const wrapper = mountSwitcher(theme(), i18n({ language: 'Language' }));
        expect(wrapper.find('.sa-theme-switcher').exists()).toBe(true);
    });
});

describe('ThemeSwitcher contents', () => {
    test('the button names the active scheme', () => {
        expect(buttonLabel(mountSwitcher(theme({ scheme: ref('dark') })))).toContain('Dark');
    });

    test("'system' is named as itself, not as what it resolves to", () => {
        // The whole reason the control has three entries instead of a toggle.
        expect(buttonLabel(mountSwitcher(theme({ scheme: ref('system') })))).toContain('System');
    });

    test('an unknown active scheme falls back to its value instead of blanking', () => {
        expect(buttonLabel(mountSwitcher(theme({ scheme: ref('sepia') })))).toContain('sepia');
    });

    test('the accessible label comes from the catalog', () => {
        const wrapper = mountSwitcher(theme());
        expect(wrapper.find('.sa-theme-switcher').attributes('aria-label')).toBe('Appearance');
    });

    test('all three schemes become menu entries', async () => {
        const entries = await openMenu(mountSwitcher(theme()));
        expect(entries).toHaveLength(3);
        expect(entries.map((e) => e.textContent).join(' ')).toContain('System');
    });
});

describe('ThemeSwitcher selection', () => {
    test('picking an entry writes the shared scheme', async () => {
        const scheme = ref('system');
        const entries = await openMenu(mountSwitcher(theme({ scheme })));
        (entries[1] as HTMLElement).click();
        expect(scheme.value).toBe('dark');
    });

    test("picking 'system' stores 'system' rather than what it resolves to", async () => {
        // A control that wrote `resolved` would look right on the screen and be
        // wrong the next time the machine changes its mind — the tab would stop
        // following the OS, which is the only thing 'system' asks for.
        const scheme = ref('dark');
        const entries = await openMenu(mountSwitcher(theme({ scheme })));
        (entries[2] as HTMLElement).click();
        expect(scheme.value).toBe('system');
    });

    test('only the active entry carries the check mark', async () => {
        const entries = await openMenu(mountSwitcher(theme({ scheme: ref('dark') })));
        expect(entries[0].querySelector('.q-icon')).toBeNull();
        expect(entries[1].querySelector('.q-icon')).not.toBeNull();
        expect(entries[2].querySelector('.q-icon')).toBeNull();
    });
});
