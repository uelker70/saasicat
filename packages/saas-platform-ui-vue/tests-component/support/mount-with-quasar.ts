// Mount helper for the SFC tests.
//
// `app.use(Quasar)` installs the plugin but registers no components — in an app
// that job belongs to `@quasar/vite-plugin`'s auto-import. Without registering
// them here every `q-*` stays an unresolved custom element, props end up as raw
// attributes and assertions pass or fail for reasons that have nothing to do
// with the component under test.

import {
    QBtn,
    QIcon,
    QInput,
    QItem,
    QItemSection,
    QList,
    QMenu,
    QSelect,
    Quasar,
    ClosePopup,
} from 'quasar';
import { mount, type MountingOptions } from '@vue/test-utils';
import type { Component } from 'vue';

const QUASAR_COMPONENTS = { QBtn, QIcon, QInput, QItem, QItemSection, QList, QMenu, QSelect };

export function mountWithQuasar<T extends Component>(
    component: T,
    options: MountingOptions<Record<string, unknown>> = {},
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
    } as MountingOptions<Record<string, unknown>>);
}
