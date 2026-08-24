// Mount helper for the SFC tests.
//
// `app.use(Quasar)` installs the plugin but registers no components — in an app
// that job belongs to `@quasar/vite-plugin`'s auto-import. Without registering
// them here every `q-*` stays an unresolved custom element, props end up as raw
// attributes and assertions pass or fail for reasons that have nothing to do
// with the component under test.

import {
    QBanner,
    QBtn,
    QCard,
    QCardActions,
    QCardSection,
    QCheckbox,
    QDialog,
    QForm,
    QIcon,
    QInnerLoading,
    QInput,
    QItem,
    QItemSection,
    QList,
    QMenu,
    QSelect,
    QSlideTransition,
    QSpinner,
    QTable,
    QToggle,
    Quasar,
    ClosePopup,
} from 'quasar';
import { mount, type ComponentMountingOptions } from '@vue/test-utils';
import type { Component } from 'vue';

const QUASAR_COMPONENTS = {
    QBanner,
    QBtn,
    QCard,
    QCardActions,
    QCardSection,
    QCheckbox,
    QDialog,
    QForm,
    QIcon,
    QInnerLoading,
    QInput,
    QItem,
    QItemSection,
    QList,
    QMenu,
    QSelect,
    QSlideTransition,
    QSpinner,
    QTable,
    QToggle,
};

export function mountWithQuasar(
    component: Component,
    options: ComponentMountingOptions<Component> = {},
) {
    const { global: globalOptions = {}, ...rest } = options;
    return mount(component, {
        ...rest,
        global: {
            ...globalOptions,
            plugins: [Quasar, ...(globalOptions.plugins ?? [])],
            components: { ...QUASAR_COMPONENTS, ...(globalOptions.components ?? {}) },
            directives: { ClosePopup, ...(globalOptions.directives ?? {}) },
        },
    });
}
