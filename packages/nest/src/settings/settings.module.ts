// SettingsModule — the record of the applied configuration and the endpoint
// that shows it.
//
// Composed by `SaaSiCatModule` for every configuration; the individual module
// is the escape hatch for an application that wires the platform by hand.
// Needs `PlanCatalogModule` in scope (it is global by default).

import {
    type CanActivate,
    type DynamicModule,
    type ForwardReference,
    Module,
    type Provider,
    type Type,
} from '@nestjs/common';
import type { AppliedSettingsPort } from '@saasicat/core';

import { asProvider, type ProviderSpec } from '../core/di.js';
import { AppliedSettingsRecorder } from './applied-settings.recorder.js';
import { buildSettingsController } from './settings.controller.js';
import { APPLIED_SETTINGS_PORT_TOKEN, SETTINGS_SOURCE_TOKEN } from './settings.tokens.js';

export interface SettingsModuleOptions {
    /**
     * Where the record is kept. Optional: without it the platform runs the
     * configuration all the same and says once, at boot, that it is not
     * recording it.
     */
    port?: ProviderSpec<AppliedSettingsPort>;
    /**
     * Where the running settings came from — the absolute path of the file, or
     * the phrase saying they were handed in as code. Recorded beside the
     * values, because "from where" is half of what an operator asks.
     */
    source: string;
    /** Class-level guards for `GET /admin/settings`. Required — see the controller. */
    controller: { guards: Array<Type<CanActivate>> };
    /**
     * Mount the controller at all. Default `true`; `false` for an app that
     * serves the route itself — two controllers on one path abort the boot
     * under Fastify and shadow each other under Express. The record is kept
     * either way.
     */
    includeController?: boolean;
    /** Modules whose providers the guards or the port factory resolve from. */
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
}

@Module({})
export class SettingsModule {
    static forRoot(options: SettingsModuleOptions): DynamicModule {
        const providers: Provider[] = [
            { provide: SETTINGS_SOURCE_TOKEN, useValue: options.source },
            // Bound to null rather than left unbound: the controller and the
            // recorder then read one shape, and `@Optional()` is not asked to
            // paper over a provider that is sometimes there.
            options.port
                ? asProvider(APPLIED_SETTINGS_PORT_TOKEN, options.port)
                : { provide: APPLIED_SETTINGS_PORT_TOKEN, useValue: null },
            AppliedSettingsRecorder,
        ];
        return {
            module: SettingsModule,
            imports: options.imports ?? [],
            controllers:
                options.includeController === false
                    ? []
                    : [buildSettingsController(options.controller.guards)],
            providers,
            exports: [AppliedSettingsRecorder, APPLIED_SETTINGS_PORT_TOKEN, SETTINGS_SOURCE_TOKEN],
        };
    }
}
