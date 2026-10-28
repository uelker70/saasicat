<template>
    <div class="sa-contract-lines">
        <q-input
            v-model="filter"
            outlined
            dense
            clearable
            :label="msg.contracts.dossier.filter"
            class="sa-contract-lines__filter"
        />
        <p v-if="shown.length === 0" class="sa-contract-lines__note" role="status">
            {{ formatMessage(msg.contracts.dossier.noMatch, { text: filter ?? '' }) }}
        </p>
        <AdminAccordion
            v-for="line in priced"
            :key="line.id"
            :open="opened.has(line.id)"
            @update:open="toggle(line.id)"
        >
            <!-- The separators are text: the header names the trigger, and is read as one. -->
            <template #header>
                <span class="sa-contract-lines__kind">{{
                    msg.contracts.dossier.kinds[line.kind]
                }}</span
                >{{ ' · ' }}<span class="sa-contract-lines__title">{{ line.title }}</span
                >{{ ' · ' }}<span>{{ priceOf(line) }}</span>
            </template>
            <template #header-actions>
                <AdminStatusPill
                    v-if="line.source"
                    :label="msg.contracts.dossier.sources[line.source]"
                    :tone="SOURCE_TONE[line.source]"
                    size="sm"
                />
                <router-link
                    v-if="
                        line.source === 'in-catalog' &&
                        line.kind !== 'discount' &&
                        catalogRoute(line.kind)
                    "
                    :to="catalogRoute(line.kind) ?? ''"
                    class="sa-link"
                >
                    {{ msg.contracts.dossier.openCatalog }}
                </router-link>
            </template>
            <p v-if="line.description" class="sa-contract-lines__description">
                {{ line.description }}
            </p>
            <div class="sa-contract-lines__facts">
                <KvBlock :label="msg.contracts.dossier.source" :value="sourceOf(line)" />
                <KvBlock :label="msg.contracts.dossier.quantity" :value="quantityOf(line)" />
                <KvBlock :label="msg.contracts.dossier.tax" :value="taxOf(line)" />
                <KvBlock
                    v-if="line.minimumTermUntil"
                    :label="msg.contracts.dossier.minimumTerm"
                    :value="formatDate(days.lastBefore(line.minimumTermUntil))"
                />
            </div>
            <h5 class="sa-contract-lines__heading">{{ msg.contracts.dossier.features }}</h5>
            <ul v-if="line.features.length > 0" class="sa-contract-lines__list">
                <li v-for="feature in line.features" :key="feature">{{ feature }}</li>
            </ul>
            <p v-else class="sa-contract-lines__note">{{ msg.contracts.dossier.none }}</p>
            <h5 class="sa-contract-lines__heading">{{ msg.contracts.dossier.quotas }}</h5>
            <ul v-if="quotasOf(line).length > 0" class="sa-contract-lines__list">
                <li v-for="[key, value] in quotasOf(line)" :key="key">{{ key }}: {{ value }}</li>
            </ul>
            <p v-else class="sa-contract-lines__note">{{ msg.contracts.dossier.none }}</p>
        </AdminAccordion>
        <ul v-if="discounts.length > 0" class="sa-contract-lines__discounts">
            <li v-for="line in discounts" :key="line.id">
                <span class="sa-contract-lines__kind">{{
                    msg.contracts.dossier.kinds.discount
                }}</span>
                {{ line.title }} · {{ priceOf(line) }}
            </li>
        </ul>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type {
    AdminContractLine,
    AdminContractSourceState,
    ContractLineItemKind,
} from '@saasicat/core';
import type { RouteLocationRaw } from 'vue-router';

import { contractLinesMatching } from '../../client/contract-timeline.js';
import { formatCurrency } from '../../client/i18n/currency.js';
import { formatMessage } from '../../client/i18n/format.js';
import AdminStatusPill from '../../ui/data/AdminStatusPill.vue';
import KvBlock from '../../ui/data/KvBlock.vue';
import AdminAccordion from '../../ui/page/AdminAccordion.vue';
import type { PillTone } from '../../vue/status.js';
import { useInstallationDays } from '../../vue/use-installation-days.js';
import { useSaMessages, useSuperAdminI18n } from '../../vue/use-super-admin-i18n.js';

// A contract's lines as it froze them: the plan and each add-on opening on
// their own, a filter over their features and quotas, and the discounts under
// them. Where a line came from says the catalogue's state in words, so the
// tone is never the only sign of it (`SC-ADM-041`).
const props = defineProps<{
    lines: readonly AdminContractLine[];
    /** The page's own way of writing a calendar day, so one page shows one. */
    formatDate: (value: string | null | undefined) => string;
    /** Where the catalogue shows a plan's or an add-on's kind; `null` where it is not served. */
    catalogRoute: (kind: Exclude<ContractLineItemKind, 'discount'>) => RouteLocationRaw | null;
}>();

/** A source still in the catalogue reads as it should; one gone reads quieter than one removed. */
const SOURCE_TONE: Readonly<Record<AdminContractSourceState, PillTone>> = {
    'in-catalog': 'positive',
    removed: 'warning',
    deleted: 'muted',
};

const msg = useSaMessages('subscribers');
const days = useInstallationDays();
const common = useSaMessages('common');
const { locale } = useSuperAdminI18n();

const filter = ref<string | null>('');
const opened = ref(new Set<string>());

const shown = computed(() => contractLinesMatching(props.lines, filter.value ?? ''));
const priced = computed(() => shown.value.filter((line) => line.kind !== 'discount'));
const discounts = computed(() => shown.value.filter((line) => line.kind === 'discount'));

function toggle(id: string): void {
    const next = new Set(opened.value);
    if (!next.delete(id)) next.add(id);
    opened.value = next;
}

function money(amount: number, currency: string): string {
    return formatCurrency(amount, locale.value, currency);
}

function priceOf(line: AdminContractLine): string {
    return formatMessage(msg.value.contracts.dossier.price, {
        net: money(line.priceNet, line.currency),
        cycle: common.value[line.billingCycle],
    });
}

function taxOf(line: AdminContractLine): string {
    return formatMessage(msg.value.contracts.dossier.taxAt, {
        rate: line.taxRate,
        amount: money(line.taxAmount, line.currency),
        gross: money(line.priceGross, line.currency),
    });
}

function quantityOf(line: AdminContractLine): string {
    return line.unit ? `${line.quantity} ${line.unit}` : String(line.quantity);
}

function sourceOf(line: AdminContractLine): string {
    return line.versionId ? `${line.key} · ${line.versionId}` : line.key;
}

function quotasOf(line: AdminContractLine): Array<[string, number]> {
    return Object.entries(line.quotas);
}
</script>

<style scoped>
.sa-contract-lines__filter {
    max-width: 360px;
    margin-bottom: var(--sa-space-3);
}
.sa-contract-lines__note,
.sa-contract-lines__description {
    color: var(--sa-color-fg-muted);
    margin: 0 0 var(--sa-space-2);
}
.sa-contract-lines__kind {
    color: var(--sa-color-fg-muted);
}
.sa-contract-lines__title {
    font-weight: var(--sa-weight-medium);
}
.sa-contract-lines__facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: var(--sa-space-3);
    margin-bottom: var(--sa-space-3);
}
.sa-contract-lines__heading {
    font-size: var(--sa-text-sm);
    font-weight: var(--sa-weight-semibold);
    margin: var(--sa-space-2) 0 var(--sa-space-1);
}
.sa-contract-lines__list,
.sa-contract-lines__discounts {
    margin: 0;
    padding-left: var(--sa-space-5);
}
.sa-contract-lines__discounts {
    margin-top: var(--sa-space-3);
}
</style>
