// Where a standard page answers, as the shell configured it — the
// `standardPageRoutes` its navigation is built from — so that a link from one
// page to another goes where the navigation goes. `AdminLayout` provides it;
// where nothing does, every page answers at its default route, as the
// navigation's own default.

import { inject, provide, type InjectionKey } from 'vue';
import type { StandardPageKey } from '@saasicat/core';

import { standardPageRouteOf } from '../client/nav-builder.js';

/** The route a standard page answers at. */
export type StandardPageRoute = (key: StandardPageKey) => string;

/**
 * `Symbol.for`, so a page bundled apart from the layout that provides it
 * resolves the same key.
 */
export const STANDARD_PAGE_ROUTES_KEY: InjectionKey<StandardPageRoute> = Symbol.for(
    'saasicat/ui-vue/StandardPageRoutes',
);

/** Provides `route` to the pages below the component this runs in. */
export function provideStandardPageRoutes(route: StandardPageRoute): void {
    provide(STANDARD_PAGE_ROUTES_KEY, route);
}

/** Where a standard page answers, as the shell this page runs in configured it. */
export function useStandardPageRoute(): StandardPageRoute {
    return inject(STANDARD_PAGE_ROUTES_KEY, standardPageRouteOf(undefined));
}
