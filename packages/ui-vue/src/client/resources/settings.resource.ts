// The applied configuration: what the installation runs on, since when, from
// where, and what changed between two starts.
//
// Two operations. The read is what the settings page shows; the acknowledgement
// is the one thing anybody can do to the record — it marks a change as seen and
// changes no setting. There is no write for a setting here, and there will not
// be: the file is the one place a setting lives.

import { defineResource, type ResourceContext } from './define-resource.js';
import { requestJson } from './resource-request.js';

/**
 * One leaf that differs between two starts, as the server names it.
 *
 * A type alias rather than an interface on purpose: the rows go straight into
 * `AdminTable`, whose rows are `Record<string, unknown>`, and only an alias
 * carries the implicit index signature that makes it one.
 */
export type SettingsDifferenceView = {
    /** Dotted path, as the loader names a field: `tenantBilling.cancellationNoticeDays.monthly`. */
    path: string;
    /** Absent where the leaf did not exist on that side. */
    before?: unknown;
    after?: unknown;
};

export interface SettingsChangeView {
    id: string;
    noticedAt: string;
    source: string;
    differences: SettingsDifferenceView[];
    acknowledgedAt: string | null;
    acknowledgedBy: string | null;
}

export interface AppliedSettingsView {
    /** Where the running settings came from: a file path, or a phrase saying they came in as code. */
    source: string;
    fingerprint: string;
    settings: Record<string, unknown>;
    /** Whether this installation keeps a record at all. */
    recorded: boolean;
    /** When these values became the running configuration; null where nothing is recorded. */
    appliedAt: string | null;
    /** Newest first. */
    changes: SettingsChangeView[];
}

function settingsUrl(ctx: ResourceContext): string {
    return `${ctx.apiBase}/settings`;
}

export const settingsResource = defineResource('settings', {
    read: async (http, ctx): Promise<AppliedSettingsView> => {
        const view = await requestJson<AppliedSettingsView>(http, settingsUrl(ctx));
        if (!view) throw new Error('GET /settings answered with no body');
        return view;
    },
    acknowledgeChange: async (http, ctx, id: string): Promise<SettingsChangeView> => {
        const view = await requestJson<SettingsChangeView>(
            http,
            `${settingsUrl(ctx)}/changes/${encodeURIComponent(id)}/acknowledge`,
            { method: 'POST' },
        );
        if (!view) throw new Error('POST /settings/changes/{id}/acknowledge answered with no body');
        return view;
    },
});
