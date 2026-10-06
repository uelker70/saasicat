// Which features are withdrawn, for every place in the tenant's pages that
// names what a plan or an add-on includes.
//
// Provided once by the component that holds the feature registry and read by
// `WithdrawnFeatureMark` beside each feature it names, so a list of features
// needs no further prop handed down through every level in between, and a
// place that names features shows the mark without being told a second time.

import { inject, provide, type InjectionKey } from 'vue';
import type { FeatureUiMeta, FeatureUiRegistry } from '@saasicat/core';

/** Why a feature is withdrawn and from when, as the registry marks it. */
export type WithdrawnFeature = NonNullable<FeatureUiMeta['withdrawn']>;

/** What every feature named below can ask: whether it is withdrawn, and how a date is written. */
export interface WithdrawnFeatures {
    /** The withdrawal of `featureKey`, or null where it is not withdrawn. */
    of(featureKey: string): WithdrawnFeature | null;
    /** An ISO date as the page writes dates. */
    formatDate(iso: string): string;
}

const WITHDRAWN_FEATURES_KEY: InjectionKey<WithdrawnFeatures> = Symbol.for(
    'saasicat/ui-vue-tenant/WITHDRAWN_FEATURES',
);

const NOTHING_WITHDRAWN: WithdrawnFeatures = {
    of: () => null,
    formatDate: (iso) => new Date(iso).toLocaleDateString(),
};

/** Makes the withdrawals `registry` marks known to every feature named below. */
export function provideWithdrawnFeatures(
    registry: () => FeatureUiRegistry | null | undefined,
    formatDate: (iso: string) => string,
): void {
    provide(WITHDRAWN_FEATURES_KEY, {
        of: (featureKey) => registry()?.[featureKey]?.withdrawn ?? null,
        formatDate,
    });
}

/** What was provided above; where nothing was, no feature is withdrawn. */
export function useWithdrawnFeatures(): WithdrawnFeatures {
    return inject(WITHDRAWN_FEATURES_KEY, NOTHING_WITHDRAWN);
}
