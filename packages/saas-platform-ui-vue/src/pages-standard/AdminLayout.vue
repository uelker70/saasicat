<template>
    <q-layout view="lHh Lpr lFf">
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
                <q-badge class="sa-admin-badge q-mr-sm">{{ msg.header.roleBadge }}</q-badge>
                <div class="sa-admin-user">
                    <q-avatar size="32px" class="sa-admin-user__avatar">
                        {{ initials }}
                    </q-avatar>
                    <div class="column items-start q-mr-sm sa-admin-user__name">
                        <div class="text-body2 text-weight-semibold">{{ userName }}</div>
                        <div class="text-caption sa-admin-user__email">{{ userEmail }}</div>
                    </div>
                    <q-btn flat round dense icon="logout" size="sm" @click="emit('logout')">
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
                    <div class="sa-admin-drawer__logo">{{ brandLogoText }}</div>
                    <div>
                        <div class="sa-admin-drawer__brand-name">{{ brandName }}</div>
                        <div class="sa-admin-drawer__brand-tag">
                            {{ brandTag }} v{{ adminUiVersion }}
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
            <div :class="['sa-admin-content', { 'sa-admin-content--fullbleed': isFullbleed }]">
                <router-view />
            </div>
        </q-page-container>
    </q-layout>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import type { AdminManifest, StandardPageKey } from '@saasicat/types';
import { buildRoutes, buildSidebar, defaultSectionOrder } from '../client/nav-builder.js';
import { useSaMessages, useSuperAdminI18n } from '../vue/use-super-admin-i18n.js';
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
//                           manifest (e.g. an app-specific "Plan-Versionen" page)
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
        brandLogoText: string;
        brandName: string;
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
        brandTag: 'SuperAdmin',
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

const route = useRoute();
const msg = useSaMessages('shell');
const { locale } = useSuperAdminI18n();
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
    const m = props.manifest;
    if (!m) {
        // Pre-manifest: static fallback + local items as one unnamed
        // section, so that the UI has no flicker before manifest load.
        return [{ title: null, items: [...props.staticNavFallback, ...props.localItems] }];
    }
    const routes = buildRoutes(m, {
        locale: locale.value,
        standardPageRoutes: props.standardPageRoutes,
        standardPageNavSection: props.standardPageNavSection,
        availableExtensions: props.availableExtensions,
    });
    const sections = buildSidebar(routes, props.sectionOrder ?? defaultSectionOrder(locale.value));
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
    return item?.label ?? `${props.brandName} SuperAdmin`;
});
</script>

<style scoped>
.sa-admin-banner {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 6px 12px;
    font-size: 12px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
}
.sa-admin-banner--prod {
    background: linear-gradient(90deg, #b91c1c, #dc2626);
    color: #fff;
}

.sa-admin-header {
    background: var(--sa-admin-header-bg, linear-gradient(90deg, #0f172a, #1e293b));
    color: var(--sa-admin-header-fg, #fff);
}
.sa-admin-header__sub {
    font-size: 11px;
    color: var(--sa-admin-header-sub, #fbbf24);
    font-weight: 400;
}

.sa-admin-badge {
    background: var(--sa-admin-badge-bg, #f59e0b);
    color: var(--sa-admin-badge-fg, #0f172a);
    font-weight: 800;
    letter-spacing: 0.08em;
    font-size: 10px;
    padding: 4px 8px;
}

.sa-admin-user {
    display: flex;
    align-items: center;
    gap: 8px;
}
.sa-admin-user__avatar {
    background: var(--sa-admin-user-avatar-bg, #f59e0b);
    color: var(--sa-admin-user-avatar-fg, #fff);
}
.sa-admin-user__name {
    line-height: 1.05;
}
.sa-admin-user__email {
    color: var(--sa-admin-user-email, #fbbf24);
}

.sa-admin-drawer :deep(.q-drawer),
.sa-admin-drawer :deep(.q-drawer__content),
.sa-admin-drawer__stack {
    background: var(--sa-admin-drawer-bg, #0b1220);
    color: var(--sa-admin-drawer-fg, #f1f5f9);
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
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.sa-admin-drawer__logo {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: var(--sa-admin-drawer-logo-bg, linear-gradient(135deg, #f59e0b, #d97706));
    color: var(--sa-admin-drawer-logo-fg, #0f172a);
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
}
.sa-admin-drawer__brand-name {
    font-weight: 800;
    color: #fff;
}
.sa-admin-drawer__brand-tag {
    font-size: 11px;
    color: var(--sa-admin-drawer-brand-tag, #fbbf24);
    text-transform: uppercase;
    letter-spacing: 0.08em;
}

.sa-admin-drawer__list {
    flex: 1;
    padding: 6px 4px;
}
.sa-admin-drawer__section {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--sa-admin-drawer-section-fg, #64748b);
    padding: 14px 18px 6px;
    font-weight: 600;
}
.sa-admin-drawer__list :deep(.q-item) {
    color: var(--sa-admin-drawer-item-fg, #cbd5e1);
    border-radius: 7px;
    margin: 1px 6px;
    min-height: 36px;
    padding: 6px 12px;
    font-size: 13.5px;
    font-weight: 500;
}
.sa-admin-drawer__list :deep(.q-item__section--avatar) {
    min-width: 28px;
    padding-right: 8px;
}
.sa-admin-drawer__list :deep(.q-item .q-icon) {
    color: #e2e8f0;
}
.sa-admin-drawer__list :deep(.q-item:hover) {
    background: var(--sa-admin-drawer-hover-bg, rgba(245, 158, 11, 0.15));
    color: var(--sa-admin-drawer-hover-fg, #fbbf24);
}
.sa-admin-drawer__list :deep(.q-item:hover .q-icon) {
    color: var(--sa-admin-drawer-hover-fg, #fbbf24);
}
.sa-admin-drawer__list :deep(.sa-admin-drawer__item--active) {
    background: var(--sa-admin-drawer-active-bg, rgba(245, 158, 11, 0.22)) !important;
    color: var(--sa-admin-drawer-active-fg, #fbbf24) !important;
    font-weight: 600;
}
.sa-admin-drawer__list :deep(.sa-admin-drawer__item--active .q-icon) {
    color: var(--sa-admin-drawer-active-fg, #fbbf24);
}

.sa-admin-drawer__footer {
    padding: 12px 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 11px;
    color: #cbd5e1;
}
.sa-admin-drawer__doc {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    color: #e2e8f0;
    text-decoration: none;
}
.sa-admin-drawer__doc:hover {
    color: var(--sa-admin-drawer-hover-fg, #fbbf24);
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
