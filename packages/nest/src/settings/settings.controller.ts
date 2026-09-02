// `GET /admin/settings` — what the installation is running on, read-only.
//
// Built at boot with the consumer's guards, like the discovery controller: the
// platform does not know how an installation authenticates, and a settings
// endpoint registered without auth would hand the configuration to anybody.

import {
    type CanActivate,
    Controller,
    Get,
    Inject,
    NotFoundException,
    Optional,
    Param,
    Post,
    Req,
    type Type,
    UseGuards,
} from '@nestjs/common';
import { SETTINGS_ERROR_CODES } from '@saasicat/core';
import {
    type AppliedSettingsPort,
    type AppliedSettingsValues,
    diffSettings,
    type PlanCatalog,
    type SettingsChangeRecord,
    type SettingsDifference,
    settingsSubtreeOf,
} from '@saasicat/core';

import { PLAN_CATALOG_TOKEN } from '../billing/plan-catalog.module.js';
import { actorTagOf, defaultActorFromRequest, WebAuditLogger } from '../core/web-audit.js';
import { codedError } from '../errors/coded-error.js';
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
            // Optional, like `catalog-entries.controller.ts` has it: this factory
            // is public, and an app that mounts the controller itself should not
            // have to know a platform-internal class to resolve it. Without the
            // logger the acknowledgement is not audited and the actor tag comes
            // from the request's own defaults.
            @Optional()
            @Inject(WebAuditLogger)
            private readonly audit: WebAuditLogger | null = null,
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
                changes: changes.map(toChangeView),
            };
        }

        /**
         * Marks a change as seen. The record survives until this is called —
         * that is what makes it a record rather than a log line — and the
         * acknowledgement keeps its first author: a second call changes nothing
         * and answers the record as it stands.
         */
        @Post('settings/changes/:id/acknowledge')
        async acknowledge(
            @Param('id') id: string,
            @Req() request: unknown,
        ): Promise<SettingsChangeView> {
            if (!this.port) {
                throw new NotFoundException(
                    codedError(SETTINGS_ERROR_CODES.SETTINGS_CHANGE_NOT_FOUND),
                );
            }
            const acknowledged = await this.port.acknowledgeChange(
                id,
                this.audit?.actorTagFromRequest(request) ??
                    actorTagOf(defaultActorFromRequest(request)),
                new Date(),
            );
            if (!acknowledged) {
                throw new NotFoundException(
                    codedError(SETTINGS_ERROR_CODES.SETTINGS_CHANGE_NOT_FOUND),
                );
            }
            await this.audit?.logFromRequest(
                request,
                'SettingsChange',
                id,
                'SETTINGS_CHANGE_ACKNOWLEDGE',
            );
            return toChangeView(acknowledged);
        }
    }

    return GeneratedSettingsController;
}

function toChangeView(change: SettingsChangeRecord): SettingsChangeView {
    return {
        id: change.id,
        noticedAt: change.noticedAt.toISOString(),
        source: change.source,
        differences: diffSettings(change.previous, change.current),
        acknowledgedAt: change.acknowledgedAt?.toISOString() ?? null,
        acknowledgedBy: change.acknowledgedBy,
    };
}
