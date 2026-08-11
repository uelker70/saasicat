<template>
    <div class="sa-marketing-window">
        <div class="sa-marketing-chrome">
            <span class="sa-marketing-chrome-dot" style="background: #ef4444" />
            <span class="sa-marketing-chrome-dot" style="background: #f59e0b" />
            <span class="sa-marketing-chrome-dot" style="background: #10b981" />
            <div class="sa-marketing-chrome-url">{{ previewUrl }}</div>
        </div>
        <div class="sa-marketing-canvas">
            <div class="sa-marketing-eyebrow">{{ msg.preview.eyebrow }}</div>
            <!-- Not a heading element: this is a picture of the public landing
                 page inside a browser mock-up, and assistive technology cannot
                 tell a mock-up from the document it is embedded in — a real
                 <h1> here would be a second page heading. -->
            <div class="sa-marketing-hero">{{ msg.preview.hero }}</div>
            <p class="sa-marketing-sub">{{ msg.preview.sub }}</p>

            <div
                v-if="visibleRows.length === 0"
                class="sa-marketing-banner sa-marketing-banner--info"
            >
                {{ msg.preview.emptyBefore }} <strong>{{ msg.tabs.admin }}</strong
                >{{ msg.preview.emptyAfter }}
            </div>

            <div v-else class="sa-marketing-grid">
                <div
                    v-for="row in visibleRows"
                    :key="row.plan.id"
                    class="sa-marketing-card"
                    :class="{ featured: row.m.highlight, 'has-promo': !!promoOf(row) }"
                >
                    <div
                        v-if="promoOf(row)"
                        class="sa-marketing-promo-ribbon"
                        :style="{ background: promoColorOf(row) }"
                    >
                        {{ promoBadgeOf(row) }}
                    </div>
                    <span v-else-if="row.m.badge" class="sa-marketing-card-badge">{{
                        row.m.badge
                    }}</span>
                    <div class="sa-marketing-card-key">{{ row.plan.planKey }}</div>
                    <div class="sa-marketing-card-name">
                        {{ row.m.displayLabel || row.plan.label }}
                    </div>
                    <div class="sa-marketing-card-desc">
                        {{ row.m.description || row.plan.description || '—' }}
                    </div>

                    <div class="sa-marketing-card-price">
                        <template v-if="row.m.priceTag">
                            <span class="sa-marketing-card-price-big" style="font-size: 22px">
                                {{ row.m.priceTag }}
                            </span>
                        </template>
                        <template v-else-if="!row.liveVersion">
                            <span class="sa-marketing-card-price-big" style="font-size: 22px">
                                {{ msg.preview.priceOnRequest }}
                            </span>
                        </template>
                        <template v-else-if="promoResultOf(row)">
                            <span class="sa-marketing-card-price-big">
                                {{ formatEuro(promoResultOf(row)?.discounted ?? 0) }}
                            </span>
                            <span class="sa-marketing-card-price-unit">{{
                                msg.preview.perMonth
                            }}</span>
                        </template>
                        <template v-else>
                            <span class="sa-marketing-card-price-big">
                                {{ formatEuro(monthlyOf(row)) }}
                            </span>
                            <span class="sa-marketing-card-price-unit">{{
                                msg.preview.perMonth
                            }}</span>
                        </template>
                    </div>
                    <div v-if="promoResultOf(row)" class="sa-marketing-card-price-strike">
                        <s>{{ formatEuro(promoResultOf(row)?.original ?? 0) }}</s>
                        <span class="sa-marketing-price-regular">{{
                            msg.preview.regularPrice
                        }}</span>
                    </div>
                    <div
                        v-else-if="row.liveVersion && yearlyOf(row) > 0 && !row.m.priceTag"
                        class="sa-marketing-card-price-y"
                    >
                        {{
                            formatMessage(msg.preview.orYearly, {
                                price: formatEuro(yearlyOf(row)),
                            })
                        }}
                    </div>

                    <button type="button" class="sa-marketing-card-cta">{{ ctaText(row) }}</button>
                    <div
                        v-if="showTrialNote(row) && !promoOf(row)"
                        class="sa-marketing-card-trialnote"
                    >
                        {{ formatMessage(msg.preview.trialNote, { days: row.m.trialDays }) }}
                    </div>
                    <div v-if="promoFineprintOf(row)" class="sa-marketing-card-fineprint">
                        {{ promoFineprintOf(row) }}
                    </div>

                    <div class="sa-marketing-card-includes">{{ msg.topFeatures }}</div>
                    <ul v-if="row.m.topFeatures.length > 0" class="sa-marketing-card-features">
                        <li v-for="(f, i) in row.m.topFeatures" :key="i">
                            <span class="sa-marketing-tick">
                                <svg
                                    width="14"
                                    height="14"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    stroke-width="3"
                                >
                                    <path d="M20 6 9 17l-5-5" />
                                </svg>
                            </span>
                            <span>
                                {{ topFeatureLabel(f) }}<template v-if="f.strong"> · </template>
                                <b v-if="f.strong">{{ f.strong }}</b>
                            </span>
                        </li>
                    </ul>
                    <div v-else class="sa-marketing-card-features-empty">
                        {{ msg.preview.noTopFeatures }}
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import type { MarketingTopFeature, PromotionResult, PromotionRow } from '@saasicat/types';
import { formatMessage } from '../../client/i18n/format.js';
import { useSaMessages } from '../../vue/use-super-admin-i18n.js';
import type { MarketingRow } from './types.js';

defineProps<{
    visibleRows: MarketingRow[];
    previewUrl: string;
    monthlyOf: (row: MarketingRow) => number;
    yearlyOf: (row: MarketingRow) => number;
    formatEuro: (value: number) => string;
    promoOf: (row: MarketingRow) => PromotionRow | null;
    promoResultOf: (row: MarketingRow) => PromotionResult | null;
    promoBadgeOf: (row: MarketingRow) => string;
    promoFineprintOf: (row: MarketingRow) => string;
    promoColorOf: (row: MarketingRow) => string;
    ctaText: (row: MarketingRow) => string;
    showTrialNote: (row: MarketingRow) => boolean;
    topFeatureLabel: (feature: MarketingTopFeature) => string;
}>();

const msg = useSaMessages('marketing');
</script>
