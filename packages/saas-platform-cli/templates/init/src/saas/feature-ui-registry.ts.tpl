import type { FeatureUiRegistry } from '@saasicat/types';

/**
 * Labels and icons for the feature and quota keys discovery finds in your code.
 *
 * It does not decide what exists — the `@RequireFeature` and `@DefinesQuota`
 * decorators do, and the scanner reads them at boot. This only stops the
 * SuperAdmin catalogue from showing raw keys. Icons are Material Symbols names.
 */
export const __REGISTRY_CONST__: FeatureUiRegistry = {
    __FEATURE_KEY__: {
        label: '__APP_NAME__',
        description: 'What this feature lets a tenant do.',
        icon: 'check_circle',
    },
};
