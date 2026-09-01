// `GET /admin/settings` — what the installation is running on, read-only.
//
// Built at boot with the consumer's guards, like the discovery controller: the
// platform does not know how an installation authenticates, and a settings
// endpoint registered without auth would hand the configuration to anybody.

import { type CanActivate, Controller, Get, Inject, type Type, UseGuards } from '@nestjs/common';
import {
    type AppliedSettingsPort,
    type AppliedSettingsValues,
    diffSettings,
    type PlanCatalog,
    type SettingsDifference,
    settingsSubtreeOf,
} from '@saasicat/core';

import { PLAN_CATALOG_TOKEN } from '../billing/plan-catalog.module.js';
import { fingerprintOf } from './settings-fingerprint.js';
import { APPLIED_SETTINGS_PORT_TOKEN, SETTINGS_SOURCE_TOKEN } from './settings.tokens.js';

/** How many past changes the screen is shown. */
const RECENT_CHANGES = 20;

export interface SettingsChangeView {
    id: string;
    noticedAt: string;
    source: string;
    differences: SettingsDifference[];
    acknowledgedAt: string | null;
    acknowledgedBy: string | null;
}

/**
 * The running configuration and its record.
 *
 * `settings`, `fingerprint` and `source` describe what IS running — read off
 * the catalogue in memory, so they are right even where nothing is recorded.
 * `appliedAt` is the record's answer to "since when", and it is null where
 * there is no record to ask: the installation keeps none, or the write at boot
 * failed and the record describes an earlier configuration.
 */
export interface AppliedSettingsView {
    source: string;
    fingerprint: string;
    settings: AppliedSettingsValues;
    /** Whether this installation keeps a record at all. */
    recorded: boolean;
    appliedAt: string | null;
    /** Newest first; empty where nothing is recorded. */
    changes: SettingsChangeView[];
}

export function buildSettingsController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin')
    @UseGuards(...guards)
    class GeneratedSettingsController {
        // Explicit @Inject: tsup/esbuild emit no `design:paramtypes`.
        constructor(
            @Inject(PLAN_CATALOG_TOKEN) private readonly catalog: PlanCatalog,
            @Inject(SETTINGS_SOURCE_TOKEN) private readonly source: string,
            @Inject(APPLIED_SETTINGS_PORT_TOKEN)
            private readonly port: AppliedSettingsPort | null,
        ) {}

        @Get('settings')
        async getSettings(): Promise<AppliedSettingsView> {
            const settings = settingsSubtreeOf(this.catalog);
            const fingerprint = fingerprintOf(settings);
            const base = { source: this.source, fingerprint, settings };
            if (!this.port) return { ...base, recorded: false, appliedAt: null, changes: [] };

            const [applied, changes] = await Promise.all([
                this.port.readApplied(),
                this.port.listChanges({ limit: RECENT_CHANGES }),
            ]);
            return {
                ...base,
                recorded: true,
                appliedAt:
                    applied?.fingerprint === fingerprint ? applied.appliedAt.toISOString() : null,
                changes: changes.map((change) => ({
                    id: change.id,
                    noticedAt: change.noticedAt.toISOString(),
                    source: change.source,
                    differences: diffSettings(change.previous, change.current),
                    acknowledgedAt: change.acknowledgedAt?.toISOString() ?? null,
                    acknowledgedBy: change.acknowledgedBy,
                })),
            };
        }
    }

    return GeneratedSettingsController;
}
