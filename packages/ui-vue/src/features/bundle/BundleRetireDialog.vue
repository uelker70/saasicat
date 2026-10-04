<template>
    <VersionRetireDialog
        :flow="flow"
        :texts="msg.retireDialog"
        :intro="intro"
        :replacement="replacementText"
        :no-version-on-sale="noVersionOnSale"
        :skip-lines="skipLines"
    />
</template>

<script setup lang="ts">
// Retiring an add-on version for the bookings on it. There is nothing to
// choose: the bookings continue on the add-on's version on sale, so they stay
// the same bookings. The flow is `useBundleVersionRetirement`'s, and the dialog
// is the one a plan version is retired with.

import { computed } from 'vue';
import type { BundleRetirementSkipReason } from '@saasicat/core';

import { formatMessage } from '../../client/i18n/format.js';
import { retirementSkipLines } from '../../client/version-retirement.js';
import type { BundleVersionRetirementFlow } from '../../vue/use-bundle-version-retirement.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import VersionRetireDialog from '../retirement/VersionRetireDialog.vue';

const props = defineProps<{ flow: BundleVersionRetirementFlow }>();

const msg = useSaMessages('bundles');

const preview = computed(() => props.flow.preview.value);
const intro = computed(() => {
    const retired = props.flow.target.value;
    return retired
        ? formatMessage(msg.value.retireDialog.intro, {
              bundleKey: retired.bundleKey,
              version: retired.version,
          })
        : '';
});
const noVersionOnSale = computed(() => {
    const retired = props.flow.target.value;
    if (!retired || props.flow.replacement.value) return '';
    return formatMessage(msg.value.retireDialog.noVersionOnSale, { bundleKey: retired.bundleKey });
});
const replacementText = computed(() =>
    preview.value
        ? formatMessage(msg.value.retireDialog.replacement, {
              bundleKey: preview.value.replacement.bundleKey,
              version: preview.value.replacement.version,
          })
        : '',
);
const skipLines = computed(() => {
    const words = msg.value.retireDialog.skipped;
    const sentences: Record<BundleRetirementSkipReason, string> = {
        ended: words.ended,
        'cancelled-before': words.cancelledBefore,
        'no-term': words.noTerm,
        'already-told': words.alreadyTold,
    };
    return preview.value ? retirementSkipLines(preview.value, sentences) : [];
});
</script>
