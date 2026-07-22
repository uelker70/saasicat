<template>
    <div class="mc-window">
        <div class="mc-chrome">
            <span class="mc-chrome-dot" style="background: #ef4444" />
            <span class="mc-chrome-dot" style="background: #f59e0b" />
            <span class="mc-chrome-dot" style="background: #10b981" />
            <div class="mc-chrome-url">{{ previewUrl }}</div>
        </div>
        <div class="mc-canvas">
            <div class="mc-eyebrow">{{ msg.preview.eyebrow }}</div>
            <h1 class="mc-hero">{{ msg.preview.hero }}</h1>
            <p class="mc-sub">{{ msg.preview.sub }}</p>

            <div v-if="visibleRows.length === 0" class="mc-banner mc-banner--info">
                {{ msg.preview.emptyBefore }} <strong>{{ msg.tabs.admin }}</strong
                >{{ msg.preview.emptyAfter }}
            </div>

            <div v-else class="mc-grid">
                <div
                    v-for="row in visibleRows"
                    :key="row.plan.id"
                    class="mc-card"
                    :class="{ featured: row.m.highlight, 'has-promo': !!promoOf(row) }"
                >
                    <div
                        v-if="promoOf(row)"
                        class="mc-promo-ribbon"
                        :style="{ background: promoColorOf(row) }"
                    >
                        {{ promoBadgeOf(row) }}
                    </div>
                    <span v-else-if="row.m.badge" class="mc-card-badge">{{ row.m.badge }}</span>
                    <div class="mc-card-key">{{ row.plan.planKey }}</div>
                    <div class="mc-card-name">
                        {{ row.m.displayLabel || row.plan.label }}
                    </div>
                    <div class="mc-card-desc">
                        {{ row.m.description || row.plan.description || '—' }}
                    </div>

                    <div class="mc-card-price">
                        <template v-if="row.m.priceTag">
                            <span class="mc-card-price-big" style="font-size: 22px">
                                {{ row.m.priceTag }}
                            </span>
                        </template>
                        <template v-else-if="!row.liveVersion">
                            <span class="mc-card-price-big" style="font-size: 22px">
                                {{ msg.preview.priceOnRequest }}
                            </span>
                        </template>
                        <template v-else-if="promoResultOf(row)">
                            <span class="mc-card-price-big">
                                {{ formatEuro(promoResultOf(row)?.discounted ?? 0) }}
                            </span>
                            <span class="mc-card-price-unit">{{ msg.preview.perMonth }}</span>
                        </template>
                        <template v-else>
                            <span class="mc-card-price-big">
                                {{ formatEuro(monthlyOf(row)) }}
                            </span>
                            <span class="mc-card-price-unit">{{ msg.preview.perMonth }}</span>
                        </template>
                    </div>
                    <div v-if="promoResultOf(row)" class="mc-card-price-strike">
                        <s>{{ formatEuro(promoResultOf(row)?.original ?? 0) }}</s>
                        <span class="mc-price-regular">{{ msg.preview.regularPrice }}</span>
                    </div>
                    <div
                        v-else-if="row.liveVersion && yearlyOf(row) > 0 && !row.m.priceTag"
                        class="mc-card-price-y"
                    >
                        {{
                            formatMessage(msg.preview.orYearly, {
                                price: formatEuro(yearlyOf(row)),
                            })
                        }}
                    </div>

                    <button type="button" class="mc-card-cta">{{ ctaText(row) }}</button>
                    <div v-if="showTrialNote(row) && !promoOf(row)" class="mc-card-trialnote">
                        {{ formatMessage(msg.preview.trialNote, { days: row.m.trialDays }) }}
                    </div>
                    <div v-if="promoFineprintOf(row)" class="mc-card-fineprint">
                        {{ promoFineprintOf(row) }}
                    </div>

                    <div class="mc-card-includes">{{ msg.topFeatures }}</div>
                    <ul v-if="row.m.topFeatures.length > 0" class="mc-card-features">
                        <li v-for="(f, i) in row.m.topFeatures" :key="i">
                            <span class="mc-tick">
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
                    <div v-else class="mc-card-features-empty">
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
