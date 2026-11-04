<template>
    <TenantCardSection v-if="documents.available.value" class="sp-invoices">
        <section :aria-labelledby="headingId">
            <h3 :id="headingId" class="sp-invoices__title">{{ i18n.invoicesTitle }}</h3>
            <p v-if="singleIssuer" class="sp-invoices__sub">{{ issuedBy(singleIssuer) }}</p>

            <p v-if="documents.loading.value && rows.length === 0" class="sp-invoices__sub">
                {{ i18n.loading }}
            </p>
            <p
                v-else-if="documents.error.value && rows.length === 0"
                class="sp-invoices__error"
                role="alert"
            >
                {{ i18n.invoicesLoadFailed }}
            </p>
            <p v-else-if="rows.length === 0" class="sp-invoices__sub">{{ i18n.invoicesEmpty }}</p>
            <div v-else class="sp-invoices__scroll">
                <table class="sp-invoices__table">
                    <thead>
                        <tr>
                            <th scope="col">{{ i18n.invoicesColumnNumber }}</th>
                            <th scope="col">{{ i18n.invoicesColumnIssued }}</th>
                            <th scope="col">{{ i18n.invoicesColumnPeriod }}</th>
                            <th scope="col">{{ i18n.invoicesColumnDue }}</th>
                            <th scope="col" class="sp-invoices__amount">
                                {{ i18n.invoicesColumnTotal }}
                            </th>
                            <th scope="col">{{ i18n.invoicesColumnStanding }}</th>
                            <th scope="col">{{ i18n.invoicesColumnDocument }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="row in rows" :id="row.anchor" :key="row.id" tabindex="-1">
                            <td>
                                {{ row.number }}
                                <span v-if="row.issuer" class="sp-invoices__issuer">
                                    {{ issuedBy(row.issuer) }}
                                </span>
                            </td>
                            <td>{{ row.issued }}</td>
                            <td>{{ row.period }}</td>
                            <td>{{ row.due }}</td>
                            <td class="sp-invoices__amount">{{ row.total }}</td>
                            <td>
                                <span v-if="row.payment" class="sp-invoices__standing">
                                    {{ row.payment }}
                                </span>
                                <span
                                    v-for="link in row.links"
                                    :key="link.target"
                                    class="sp-invoices__standing"
                                >
                                    <template v-for="(part, index) in link.parts" :key="index">
                                        <a
                                            v-if="part.strong"
                                            :href="`#${link.target}`"
                                            @click.prevent="follow(link)"
                                            >{{ part.text }}</a
                                        >
                                        <template v-else>{{ part.text }}</template>
                                    </template>
                                </span>
                            </td>
                            <td>
                                <TenantButton
                                    v-if="row.documentArchived"
                                    variant="quiet"
                                    :loading="documents.downloading.value === row.id"
                                    :disabled="documents.downloading.value !== null"
                                    :aria-label="downloadLabelOf(row.number)"
                                    @click="download(() => documents.downloadInvoice(row.id))"
                                >
                                    {{ i18n.invoicesDownload }}
                                </TenantButton>
                                <span v-else class="sp-invoices__sub">
                                    {{ i18n.invoicesDocumentFollows }}
                                </span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <TenantButton
                v-if="documents.hasMore.value"
                variant="outline"
                :loading="documents.loading.value"
                class="sp-invoices__more"
                @click="documents.more()"
            >
                {{ i18n.invoicesMore }}
            </TenantButton>
            <!-- A further page that failed leaves the rows already read in place. -->
            <p
                v-if="documents.error.value && rows.length > 0"
                class="sp-invoices__error"
                role="alert"
            >
                {{ i18n.invoicesMoreFailed }}
            </p>
            <p v-if="downloadFailed" class="sp-invoices__error" role="alert">
                {{ i18n.invoicesDownloadFailed }}
            </p>
        </section>

        <section :aria-labelledby="confirmationsHeadingId" class="sp-invoices__confirmations">
            <h3 :id="confirmationsHeadingId" class="sp-invoices__title">
                {{ i18n.confirmationsTitle }}
            </h3>
            <p v-if="confirmations.length === 0" class="sp-invoices__sub">
                {{ i18n.confirmationsEmpty }}
            </p>
            <ul v-else class="sp-invoices__list">
                <li v-for="confirmation in confirmations" :key="confirmation.contractId">
                    <span>{{ confirmation.line }}</span>
                    <TenantButton
                        v-if="confirmation.archived"
                        variant="quiet"
                        :loading="documents.downloading.value === confirmation.contractId"
                        :disabled="documents.downloading.value !== null"
                        :aria-label="confirmation.downloadLabel"
                        @click="
                            download(() => documents.downloadConfirmation(confirmation.contractId))
                        "
                    >
                        {{ i18n.invoicesDownload }}
                    </TenantButton>
                    <span v-else class="sp-invoices__sub">{{ i18n.confirmationBeingMade }}</span>
                </li>
            </ul>
        </section>
    </TenantCardSection>
</template>

<script setup lang="ts">
import { useTenantInvoices, type HttpClient } from '@saasicat/ui-vue';
import { computed, nextTick, ref, useId, watch } from 'vue';

import { writeDay } from '../day-as-instant.js';
import { messageParts } from '../message-parts.js';
import { useTenantI18n } from '../tenant-i18n.js';
import TenantButton from '../ui/TenantButton.vue';
import TenantCardSection from '../ui/TenantCardSection.vue';
import '../ui/tenant-ui.css';
import { invoiceRowsOf, issuersOf, type InvoiceRowLink } from './invoice-rows.js';

// The invoices the operator issues the tenant for its subscription, and the
// contract confirmations beside them (`SC-UI-022`, `SC-UI-024`). Shown only to
// a user the server lets see them — the billing permission — and the card does
// not render for anyone else. The heading and the issuer tell them apart from
// invoices an application writes to its own customers. A document is
// downloaded once it is archived, as the file that was issued.

const props = defineProps<{
    http?: HttpClient;
    apiPrefix?: string;
    formatDate: (iso: string) => string;
    /** An amount, with the ISO 4217 currency of the invoice it is of. */
    formatCurrency: (amount: number, currency: string) => string;
}>();

const emit = defineEmits<{
    /** Whether the card shows anything, so a surrounding card can hide with it. */
    availability: [shown: boolean];
}>();

const i18n = useTenantI18n();
const documents = useTenantInvoices({ http: props.http, apiPrefix: props.apiPrefix });
watch(documents.available, (shown) => emit('availability', shown), { immediate: true });
const headingId = `sp-invoices-${useId()}`;
const confirmationsHeadingId = `sp-confirmations-${useId()}`;
const downloadFailed = ref(false);

const rows = computed(() =>
    invoiceRowsOf(documents.invoices.value, i18n.value, {
        formatDate: props.formatDate,
        formatCurrency: props.formatCurrency,
    }),
);

/** The issuer beneath the heading, where one issued them all; each row names its own otherwise. */
const singleIssuer = computed(() => {
    const issuers = issuersOf(documents.invoices.value);
    return issuers.length === 1 ? issuers[0] : null;
});

const confirmations = computed(() =>
    documents.confirmations.value.map((confirmation) => {
        const concluded = writeDay(props.formatDate, confirmation.concludedOn);
        return {
            contractId: confirmation.contractId,
            archived: confirmation.archived,
            line: sentence(i18n.value.confirmationLine, {
                plan: confirmation.planTitle ?? i18n.value.confirmationNoPlan,
                concluded,
                firstDay: writeDay(props.formatDate, confirmation.firstDay),
            }),
            downloadLabel: sentence(i18n.value.confirmationDownload, { concluded }),
        };
    }),
);

function sentence(template: string, values: Record<string, string>): string {
    return messageParts(template, values)
        .map((part) => part.text)
        .join('');
}

function issuedBy(issuer: string): string {
    return sentence(i18n.value.invoicesIssuedBy, { issuer });
}

function downloadLabelOf(number: string): string {
    return sentence(i18n.value.invoicesDownloadInvoice, { number });
}

/**
 * Leads to the invoice a link names: its row may stand on a page not read
 * yet, as a cancellation corrects an invoice of any age, so the pages up to
 * it are read first. The row then takes the focus, which scrolls it into
 * view and is where a screen reader goes on from.
 */
async function follow(link: InvoiceRowLink): Promise<void> {
    if (!(await documents.loadUntil(link.invoiceId))) return;
    await nextTick();
    document.getElementById(link.target)?.focus();
}

async function download(run: () => Promise<void>): Promise<void> {
    downloadFailed.value = false;
    try {
        await run();
    } catch {
        // The archive refused or the connection broke; the list stays as it
        // is, and the person is told the document did not arrive.
        downloadFailed.value = true;
    }
}
</script>

<style scoped>
.sp-invoices__title {
    font-size: var(--sa-text-md);
    font-weight: 600;
    line-height: var(--sa-leading-md);
    margin: 0 0 var(--sa-space-2);
}
.sp-invoices__sub {
    margin: 0 0 var(--sa-space-3);
    color: var(--sa-color-fg-muted);
    font-size: var(--sa-text-sm);
}
.sp-invoices__error {
    margin: var(--sa-space-2) 0 0;
    color: var(--sa-color-negative-fg);
}
.sp-invoices__scroll {
    overflow-x: auto;
}
.sp-invoices__table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--sa-text-sm);
}
.sp-invoices__table th,
.sp-invoices__table td {
    padding: var(--sa-space-2) var(--sa-space-3);
    border-bottom: 1px solid var(--sa-color-border);
    text-align: start;
    vertical-align: top;
}
.sp-invoices__table th {
    color: var(--sa-color-fg-secondary);
    font-weight: 600;
}
/* A row a link led to takes the focus, and shows that it has it. */
.sp-invoices__table tr:focus {
    outline: 2px solid var(--sa-color-accent);
    outline-offset: -2px;
}
.sp-invoices__table .sp-invoices__amount {
    text-align: end;
    white-space: nowrap;
}
.sp-invoices__issuer,
.sp-invoices__standing {
    display: block;
}
.sp-invoices__issuer {
    color: var(--sa-color-fg-muted);
}
.sp-invoices__more {
    margin-top: var(--sa-space-3);
}
.sp-invoices__confirmations {
    margin-top: var(--sa-space-5);
}
.sp-invoices__list {
    display: grid;
    gap: var(--sa-space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}
.sp-invoices__list li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--sa-space-3);
}
</style>
