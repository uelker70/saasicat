// The KPI cards on the dashboard, read one endpoint at a time.
//
// The endpoints are not the platform's to choose: each card carries its own in
// the admin manifest, which is how an app puts its own numbers on the
// dashboard. So this descriptor takes the card and uses the endpoint on it,
// rather than composing a path from `ctx.apiBase` the way the catalogue family
// does.
//
// What it returns is a reading, not a rendering. Which field of a response body
// holds the number is knowledge about a data shape and belongs here, where an
// app with a different shape can override one operation and keep the rest;
// turning a timestamp into text the operator can read depends on their locale
// and belongs in the page. Splitting it that way is what let the page's
// `formatKpi` callback prop go away without taking the capability with it.

import type { KpiCardDef } from '@saasicat/types';

import { requestJson } from './resource-request.js';
import { defineResource } from './define-resource.js';

/**
 * One card's answer, in the terms the card was defined in.
 *
 * `value` is `null` when the body carried no number this reader recognises —
 * the page shows a dash for it, which is a different state from a failed
 * request and reads differently on screen.
 */
export interface KpiReading {
    readonly value: string | number | null;
    /** ISO 8601, unformatted — `displayHint: 'value+timestamp'` renders it. */
    readonly timestamp?: string;
    /** Signed change over the previous period, for `displayHint: 'value+delta'`. */
    readonly delta?: number;
    /** A sub-line the server wrote itself; used when the hint asks for neither. */
    readonly sub?: string;
}

function readValue(body: Record<string, unknown>): string | number | null {
    if (typeof body.value === 'number' || typeof body.value === 'string') return body.value;
    if (typeof body.count === 'number') return body.count;
    if (typeof body.total === 'number') return body.total;
    return null;
}

export const dashboardResource = defineResource('dashboard', {
    /**
     * Reads one card.
     *
     * An app whose endpoint answers in a shape this reader does not recognise
     * overrides this operation rather than handing the page a formatter — the
     * override composes with the platform's, and it applies to every card
     * instead of to the one place a prop was threaded to.
     */
    kpi: async (http, _ctx, card: KpiCardDef): Promise<KpiReading> => {
        const body = ((await requestJson<Record<string, unknown>>(http, card.endpoint)) ??
            {}) as Record<string, unknown>;
        return {
            value: readValue(body),
            timestamp: typeof body.timestamp === 'string' ? body.timestamp : undefined,
            delta: typeof body.delta === 'number' ? body.delta : undefined,
            sub: typeof body.sub === 'string' ? body.sub : undefined,
        };
    },
});
