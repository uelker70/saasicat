<template>
    <q-layout view="lHh Lpr lFf" class="sa-admin-layout">
        <div v-if="isProduction" class="sa-admin-banner sa-admin-banner--prod">
            <q-icon name="warning" size="14px" />
            <strong>PRODUCTION</strong> — {{ msg.header.productionWarning }}
        </div>

        <q-header elevated class="sa-admin-header">
            <q-toolbar class="q-py-sm">
                <q-btn flat dense round icon="menu" @click="leftDrawerOpen = !leftDrawerOpen" />
                <q-toolbar-title class="text-weight-bold">
                    {{ currentPageTitle }}
                    <div class="sa-admin-header__sub">{{ msg.header.subtitle }}</div>
                </q-toolbar-title>
                <q-space />
                <slot name="header-actions" />
                <LocaleSwitcher class="q-mr-sm" />
                <ThemeSwitcher class="q-mr-sm" />
                <q-badge class="sa-admin-badge q-mr-sm">{{ msg.header.roleBadge }}</q-badge>
                <div class="sa-admin-user">
                    <q-avatar size="32px" class="sa-admin-user__avatar">
                        {{ initials }}
                    </q-avatar>
                    <div class="column items-start q-mr-sm sa-admin-user__name">
                        <div class="text-body2 text-weight-semibold">{{ userName }}</div>
                        <div class="text-caption sa-admin-user__email">{{ userEmail }}</div>
                    </div>
                    <q-btn flat round dense icon="logout" size="sm" @click="onLogoutClick">
                        <q-tooltip>{{ msg.header.logout }}</q-tooltip>
                    </q-btn>
                </div>
            </q-toolbar>
        </q-header>

        <q-drawer
            v-model="leftDrawerOpen"
            show-if-above
            bordered
            :width="240"
            class="sa-admin-drawer"
        >
            <div class="sa-admin-drawer__stack">
                <div class="sa-admin-drawer__brand">
                    <div class="sa-admin-drawer__logo">{{ brand.logoText }}</div>
                    <div>
                        <div class="sa-admin-drawer__brand-name">{{ brand.name }}</div>
                        <div class="sa-admin-drawer__brand-tag">
                            {{ brand.tag }} v{{ adminUiVersion }}
                        </div>
                    </div>
                </div>

                <q-list class="sa-admin-drawer__list">
                    <template v-for="section in navSections" :key="section.title ?? '__default'">
                        <div v-if="section.title" class="sa-admin-drawer__section">
                            {{ section.title }}
                        </div>
                        <q-item
                            v-for="item in section.items"
                            :key="item.to"
                            v-ripple
                            clickable
                            :to="item.to"
                            :exact="item.exact"
                            active-class="sa-admin-drawer__item--active"
                        >
                            <q-item-section avatar><q-icon :name="item.icon" /></q-item-section>
                            <q-item-section>{{ item.label }}</q-item-section>
                        </q-item>
                    </template>
                </q-list>

                <div v-if="docUrl || $slots['drawer-footer']" class="sa-admin-drawer__footer">
                    <slot name="drawer-footer">
                        <a
                            v-if="docUrl"
                            class="sa-admin-drawer__doc"
                            :href="docUrl"
                            target="_blank"
                            rel="noopener"
                        >
                            <q-icon name="menu_book" size="14px" /> {{ msg.drawer.docs }}
                        </a>
                    </slot>
                </div>
            </div>
        </q-drawer>

        <q-page-container>
            <!-- The document's only <main>. Pages must not add one of their
                 own, and must not use QPage, which renders <main> itself. -->
            <main :class="['sa-admin-content', { 'sa-admin-content--fullbleed': isFullbleed }]">
                <router-view />
            </main>
        </q-page-container>
    </q-layout>
</template>

<script setup lang="ts">
import { computed, inject, ref, getCurrentInstance } from 'vue';
import { useRoute } from 'vue-router';
import type { AdminManifest, StandardPageKey } from '@saasicat/types';
import { buildRoutes, buildSidebar, defaultSectionOrder } from '../client/nav-builder.js';
import LocaleSwitcher from '../ui/page/LocaleSwitcher.vue';
import ThemeSwitcher from '../ui/page/ThemeSwitcher.vue';
import { SUPER_ADMIN_BRAND_KEY, SUPER_ADMIN_MANIFEST_KEY } from '../vue/super-admin-context.js';
import { useSaMessages, useSuperAdminI18n } from '../vue/use-super-admin-i18n.js';
import { useSignOut } from '../vue/use-sign-out.js';
import { ADMIN_UI_VERSION } from '../client/version.js';

// SuperAdmin layout — universal platform shell for all consumer apps.
// CSS classes `sa-admin-*` with BEM convention; apps can override any class
// with equal specificity in their own CSS.
//
// App-specific bits via props:
//   - `brandLogoText`     : 2-letter abbreviation (e.g. 'ma', 'da')
//   - `brandName`         : 'DemoApp' / 'ClubApp' / …
//   - `brandTag`          : 'SuperAdmin' (default)
//   - `manifest`          : loaded AdminManifest (or null before auth)
//   - `staticNavFallback` : sidebar before manifest load (no flicker)
//   - `localItems`        : additional sidebar items not present in the
//                           manifest
//   - `availableExtensions` : set for ProjectPage capability filter
//   - `standardPageRoutes`: override per StandardPageKey (e.g.
//                           `dashboard` → '/admin/' instead of '/admin/dashboard')
//   - `pageTitleResolver` : (path) => string mapping for the header title
//   - `userName` / `userEmail` / `userInitials` : display
//   - `isProduction`      : shows red production banner
//   - `docUrl`            : optional footer link
//
// Slots:
//   - `#header-actions`   : additional buttons on the right before the badge
//                           (e.g. NotificationBell)
//   - `#drawer-footer`    : custom footer (overrides default doc link)

export interface SidebarItem {
    to: string;
    icon: string;
    label: string;
    exact?: boolean;
}

const props = withDefaults(
    defineProps<{
        /**
         * Branding. Optional — when the layout is mounted as a route component
         * inside `createSuperAdminApp({ brand })`, these default to the
         * provided brand and only need passing to override it.
         */
        brandLogoText?: string;
        brandName?: string;
        brandTag?: string;
        manifest?: AdminManifest | null;
        staticNavFallback?: readonly SidebarItem[];
        localItems?: readonly SidebarItem[];
        /**
         * Section label under which `localItems` are grouped in the drawer.
         * Default `null` ⇒ without section header (pinned at the top, as before).
         */
        localItemsSection?: string | null;
        availableExtensions?: Set<string>;
        standardPageRoutes?: Partial<Record<StandardPageKey, string>>;
        /**
         * Override for `navSection` per StandardPage. The platform default follows
         * the plan-simulation layout (Übersicht / Produktkatalog / Kunden /
         * System) and usually needs no adjustment.
         */
        standardPageNavSection?: Partial<Record<StandardPageKey, string>>;
        /**
         * Order of the section headers. Sections not listed here are
         * appended alphabetically afterwards.
         */
        sectionOrder?: readonly string[];
        pageTitleResolver?: (path: string) => string | null;
        userName?: string;
        userEmail?: string;
        userInitials?: string;
        isProduction?: boolean;
        docUrl?: string;
        adminPathPrefix?: string;
    }>(),
    {
        staticNavFallback: () => [],
        localItems: () => [],
        localItemsSection: null,
        adminPathPrefix: '/admin',
        isProduction: false,
    },
);

const emit = defineEmits<{
    (e: 'logout'): void;
}>();

const signOut = useSignOut();
const instance = getCurrentInstance();

/**
 * Signs out, and only emits instead when the app is actually listening.
 *
 * The layout is mounted as a plain route record in every consumer we have
 * (`{ path: '/admin', component: AdminLayout }`), and a route record attaches
 * no listeners — so `emit('logout')` alone made the header's sign-out button
 * do nothing at all. Apps that pass `@logout` keep full control.
 */
function onLogoutClick(): void | Promise<void> {
    // Both spellings: `@logout` lands on `onLogout`, `@logout.once` on
    // `onLogoutOnce`. Checking only the first would run the platform default
    // and never emit — silently ignoring a listener the consumer did attach.
    const listeners = instance?.vnode.props ?? {};
    if (listeners.onLogout || listeners.onLogoutOnce) {
        emit('logout');
        return;
    }
    return signOut();
}

const route = useRoute();
const msg = useSaMessages('shell');
const { messages } = useSuperAdminI18n();
// Provided by createSuperAdminApp(); null when the layout is mounted
// stand-alone. Grouped into one object so the names cannot shadow the
// same-named props inside the template.
const injectedBrand = inject(SUPER_ADMIN_BRAND_KEY, null);
// Same idea for the manifest: createSuperAdminApp({ manifestGuard: {
// getManifest } }) provides an accessor, so pages mounted straight as route
// components do not have to be wrapped just to thread the prop through.
const injectedManifest = inject(SUPER_ADMIN_MANIFEST_KEY, null);
const activeManifest = computed(() => props.manifest ?? injectedManifest?.() ?? null);
const brand = computed(() => ({
    logoText: props.brandLogoText ?? injectedBrand?.logoText ?? '',
    name: props.brandName ?? injectedBrand?.name ?? '',
    tag: props.brandTag ?? injectedBrand?.tag ?? 'SuperAdmin',
}));

const leftDrawerOpen = ref(false);

const adminUiVersion = ADMIN_UI_VERSION;

const initials = computed(() => props.userInitials ?? '');
const userName = computed(() => props.userName ?? '');
const userEmail = computed(() => props.userEmail ?? '');

const isFullbleed = computed(() => route.meta.fullbleed === true);

interface NavSection {
    title: string | null;
    items: SidebarItem[];
}

const navSections = computed<NavSection[]>(() => {
    const m = activeManifest.value;
    if (!m) {
        // Pre-manifest: static fallback + local items as one unnamed
        // section, so that the UI has no flicker before manifest load.
        return [{ title: null, items: [...props.staticNavFallback, ...props.localItems] }];
    }
    // The resolved catalog rather than the bare locale: it carries
    // `i18n.overrides` and languages the app added itself, neither of which the
    // builder can look up from a locale code.
    const nav = messages.value.nav;
    const routes = buildRoutes(m, {
        nav,
        standardPageRoutes: props.standardPageRoutes,
        standardPageNavSection: props.standardPageNavSection,
        availableExtensions: props.availableExtensions,
    });
    const sections = buildSidebar(routes, props.sectionOrder ?? defaultSectionOrder(nav));
    const result: NavSection[] = sections.map((s) => ({
        title: s.section,
        items: s.items.map((item) => ({
            to: item.path,
            icon: item.icon ?? 'circle',
            label: item.label,
            exact: item.path === props.adminPathPrefix || item.path === `${props.adminPathPrefix}/`,
        })),
    }));
    if (props.localItems.length > 0) {
        const target = props.localItemsSection;
        if (target === null) {
            result.push({ title: null, items: [...props.localItems] });
        } else {
            const existing = result.find((s) => s.title === target);
            if (existing) {
                existing.items.push(...props.localItems);
            } else {
                result.push({ title: target, items: [...props.localItems] });
            }
        }
    }
    return result;
});

const resolvedNav = computed<SidebarItem[]>(() => navSections.value.flatMap((s) => s.items));

const currentPageTitle = computed(() => {
    if (props.pageTitleResolver) {
        const t = props.pageTitleResolver(route.path);
        if (t) return t;
    }
    // Default: sidebar item label that matches the active route.
    const item = resolvedNav.value.find((i) => i.to === route.path);
    return item?.label ?? `${brand.value.name} SuperAdmin`;
});
</script>

<style scoped>
.sa-admin-banner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 6px 12px;
    font-size: var(--sa-text-sm);
    letter-spacing: 0.05em;
    text-transform: uppercase;
}
.sa-admin-banner--prod {
    /* Invariant on purpose: this strip says "you are on production", and its
     * white text has to stay readable in both themes. The `negative` roles
     * lighten in dark — for text ON dark surfaces — and would take this one to
     * 1.9:1. */
    background: linear-gradient(
        90deg,
        var(--sa-color-inverse-danger),
        var(--sa-color-inverse-danger-strong)
    );
    color: var(--sa-color-inverse-fg);
}

.sa-admin-header {
    background: var(
        --sa-admin-header-bg,
        linear-gradient(90deg, var(--sa-color-inverse-bg), var(--sa-color-inverse-surface))
    );
    color: var(--sa-admin-header-fg, var(--sa-color-inverse-fg));
}
.sa-admin-header__sub {
    font-size: var(--sa-text-xs);
    color: var(--sa-admin-header-sub, var(--sa-color-inverse-accent));
    font-weight: 400;
}

.sa-admin-badge {
    background: var(--sa-admin-badge-bg, var(--sa-color-inverse-accent));
    color: var(--sa-admin-badge-fg, var(--sa-color-inverse-accent-fg));
    font-weight: 800;
    letter-spacing: 0.08em;
    font-size: var(--sa-text-2xs);
    padding: 4px 8px;
}

.sa-admin-user {
    display: flex;
    align-items: center;
    gap: 8px;
    /* The row's flexible member. Without this the identity block below sits at
     * its content width, and a long name pushes the sign-out button off the
     * end of a `nowrap` toolbar instead of being shortened. */
    min-width: 0;
}
.sa-admin-user__avatar {
    background: var(--sa-admin-user-avatar-bg, var(--sa-color-inverse-accent));
    color: var(--sa-admin-user-avatar-fg, var(--sa-color-inverse-accent-fg));
}
.sa-admin-user__avatar,
.sa-admin-user .q-btn {
    /* The two things in this group that are controls or fixed squares. A flex
     * item shrinks from its own basis, so without this the avatar and the
     * sign-out button donate width to a name they should be donating none to —
     * the same shrink that squeezed the login mark to 0px at 320. */
    flex: none;
}
.sa-admin-user__name {
    line-height: 1.05;
    min-width: 0;
}
/* Text is what shrinking is for; a control is not. Both lines therefore
 * shorten rather than widen the group. */
.sa-admin-user__name > div {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.sa-admin-user__email {
    color: var(--sa-admin-user-email, var(--sa-color-inverse-accent));
}

/* Below `sm` the header row cannot hold everything it holds on a desktop, and
 * the switcher LABELS are the cheapest thing in it: the icon still names the
 * control, the menu still spells every option out, and — unlike hiding the
 * button — the operator can still reach both. The role badge goes with them
 * because the subtitle two lines up already carries the same word: it is the
 * platform's own `header.subtitle`, "SuperAdmin · …", and it stays on screen at
 * every width. The drawer's brand tag repeats it a third time by default.
 *
 * `599.98px` is Quasar's `xs` upper bound from `theme/_breakpoints.scss`; a
 * `<style>` block cannot read the SCSS, and a custom property is not
 * substituted inside a media condition. */
@media (max-width: 599.98px) {
    /* `!important` because the thing being hidden is Quasar's own `.block`
     * utility, which declares `display: block !important` — specificity alone
     * loses to it however long the selector gets. Same reason the active drawer
     * item above carries one. */
    .sa-admin-header :deep(.sa-locale-switcher .q-btn__content > .block),
    .sa-admin-header :deep(.sa-theme-switcher .q-btn__content > .block) {
        display: none !important;
    }
    .sa-admin-badge {
        display: none;
    }
    /* And the operator's own name and address, which at this width would be
     * bought from the page title: measured at 360 with both filled in, the
     * title got 24px — one letter — while the row spelled out an email nobody
     * came to the page to read. The avatar keeps the identity present and the
     * full text is one breakpoint away. The truncation above is what covers
     * the band where the block is shown and space is still tight. */
    .sa-admin-user__name {
        display: none;
    }
}

.sa-admin-drawer :deep(.q-drawer),
.sa-admin-drawer :deep(.q-drawer__content),
.sa-admin-drawer__stack {
    background: var(--sa-admin-drawer-bg, var(--sa-color-inverse-bg));
    color: var(--sa-admin-drawer-fg, var(--sa-color-inverse-fg-muted));
}
.sa-admin-drawer__stack {
    display: flex;
    flex-direction: column;
    height: 100%;
}

.sa-admin-drawer__brand {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 18px 16px;
    border-bottom: 1px solid var(--sa-color-inverse-border);
}
.sa-admin-drawer__logo {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: var(
        --sa-admin-drawer-logo-bg,
        linear-gradient(
            135deg,
            var(--sa-color-inverse-accent),
            var(--sa-color-inverse-accent-strong)
        )
    );
    color: var(--sa-admin-drawer-logo-fg, var(--sa-color-inverse-accent-fg));
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
}
.sa-admin-drawer__brand-name {
    font-weight: 800;
    color: var(--sa-color-inverse-fg);
}
.sa-admin-drawer__brand-tag {
    font-size: var(--sa-text-xs);
    color: var(--sa-admin-drawer-brand-tag, var(--sa-color-inverse-accent));
    text-transform: uppercase;
    letter-spacing: 0.08em;
}

.sa-admin-drawer__list {
    flex: 1;
    padding: 6px 4px;
}
.sa-admin-drawer__section {
    font-size: var(--sa-text-2xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--sa-admin-drawer-section-fg, var(--sa-color-inverse-fg-muted));
    padding: 14px 18px 6px;
    font-weight: 600;
}
.sa-admin-drawer__list :deep(.q-item) {
    color: var(--sa-admin-drawer-item-fg, var(--sa-color-inverse-fg-muted));
    border-radius: 7px;
    margin: 1px 6px;
    min-height: 36px;
    padding: 6px 12px;
    font-size: var(--sa-text-md);
    font-weight: 500;
}
.sa-admin-drawer__list :deep(.q-item__section--avatar) {
    min-width: 28px;
    padding-right: 8px;
}
.sa-admin-drawer__list :deep(.q-item .q-icon) {
    color: var(--sa-color-inverse-fg-subtle);
}
.sa-admin-drawer__list :deep(.q-item:hover) {
    background: var(--sa-admin-drawer-hover-bg, var(--sa-color-inverse-accent-surface));
    color: var(--sa-admin-drawer-hover-fg, var(--sa-color-inverse-accent));
}
.sa-admin-drawer__list :deep(.q-item:hover .q-icon) {
    color: var(--sa-admin-drawer-hover-fg, var(--sa-color-inverse-accent));
}
.sa-admin-drawer__list :deep(.sa-admin-drawer__item--active) {
    background: var(
        --sa-admin-drawer-active-bg,
        var(--sa-color-inverse-accent-surface-strong)
    ) !important;
    color: var(--sa-admin-drawer-active-fg, var(--sa-color-inverse-accent)) !important;
    font-weight: 600;
}
.sa-admin-drawer__list :deep(.sa-admin-drawer__item--active .q-icon) {
    color: var(--sa-admin-drawer-active-fg, var(--sa-color-inverse-accent));
}

.sa-admin-drawer__footer {
    padding: 12px 16px;
    border-top: 1px solid var(--sa-color-inverse-border);
    font-size: var(--sa-text-xs);
    color: var(--sa-color-inverse-fg-muted);
}
.sa-admin-drawer__doc {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    color: var(--sa-color-inverse-fg-muted);
    text-decoration: none;
}
.sa-admin-drawer__doc:hover {
    color: var(--sa-admin-drawer-hover-fg, var(--sa-color-inverse-accent));
}

.sa-admin-content {
    max-width: 1600px;
    margin: 0 auto;
    padding: 16px 24px 32px;
}
.sa-admin-content--fullbleed {
    max-width: none;
    padding: 0;
}
</style>
