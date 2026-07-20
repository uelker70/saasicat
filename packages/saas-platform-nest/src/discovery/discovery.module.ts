// DiscoveryModule — bindet den DiscoveryScanner und liefert den
// DiscoverySnapshot via DI-Token.
//
// Konsumenten-Setup:
//
// ```ts
// @Module({
//   imports: [
//     DiscoveryModule.forRoot({
//       app: { key: 'clubapp', version: '0.42.1' },
//       controller: { guards: [JwtAuthGuard, SuperAdminGuard] },
//     }),
//   ],
// })
// export class AppModule {}
// ```
//
// Konsumenten injizieren den Snapshot via:
//
// ```ts
// constructor(@Inject(DISCOVERY_SNAPSHOT_TOKEN) snapshot: DiscoverySnapshot) {…}
// ```
//
// oder direkt den Scanner für Re-Build (`DiscoveryScanner.rebuildSnapshot()`).

import {
    type CanActivate,
    type DynamicModule,
    type ForwardReference,
    Module,
    type Provider,
    type Type,
} from '@nestjs/common';
import { DiscoveryModule as NestDiscoveryModule } from '@nestjs/core';

import { buildDiscoveryController } from './discovery.controller.js';
import {
    DISCOVERY_APP_INFO_TOKEN,
    DISCOVERY_SNAPSHOT_PATH_TOKEN,
    DiscoveryScanner,
    type DiscoveryAppInfo,
} from './discovery.scanner.js';
import { DISCOVERY_SNAPSHOT_TOKEN } from './tokens.js';
import type { DiscoverySnapshot } from './types.js';

export interface DiscoveryControllerConfig {
    /**
     * Class-Level-Guards für `GET /admin/discovery`. PFLICHT — `forRoot()`
     * wirft sonst beim Boot. Übergebe `[]` explizit, wenn der Endpoint
     * absichtlich auth-frei sein soll (z. B. CI/Smoke-Test).
     */
    guards: Array<Type<CanActivate>>;
}

export interface DiscoveryModuleOptions {
    /** App-Identität, die in den Snapshot übernommen wird (`app.key`/`app.version`). */
    app: DiscoveryAppInfo;
    /**
     * Controller-Mount für `GET /admin/discovery`. Wenn weggelassen, wird der
     * Endpoint nicht registriert — Konsumenten können ihn dann selbst bauen
     * (z. B. mit anderem Pfad oder zusätzlichen Guards) und den Scanner via
     * `DISCOVERY_SNAPSHOT_TOKEN` injizieren.
     */
    controller?: DiscoveryControllerConfig;
    /**
     * Module, deren Provider im DI-Scope dieses DynamicModules sichtbar sein
     * müssen — typisch: `AuthModule`, das den `JwtAuthGuard` aus
     * `controller.guards` exportiert. Ohne diesen Eintrag schlägt NestJS
     * mit `UnknownDependenciesException` für den Guard fehl, wenn das
     * AuthModule nicht global ist.
     */
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
    /**
     * Optional: Modul global registrieren — `DISCOVERY_SNAPSHOT_TOKEN` und
     * `DiscoveryScanner` sind dann ohne erneuten `imports`-Eintrag verfügbar.
     * Default: `true`.
     */
    isGlobal?: boolean;
    /**
     * Optional: Pfad, in den der DiscoveryScanner beim
     * `OnApplicationBootstrap` den Snapshot als JSON schreibt. Konsumenten
     * (CI-Gates, Preflight-CLIs) können die Datei mit
     * `loadDiscoverySnapshotFromFile(path)` lesen, ohne selbst alle App-
     * Module zu booten. Wenn weggelassen, wird nichts geschrieben.
     */
    snapshotPath?: string | null;
}

@Module({})
export class DiscoveryModule {
    static forRoot(options: DiscoveryModuleOptions): DynamicModule {
        const isGlobal = options.isGlobal ?? true;
        const controllers: Type[] = [];

        if (options.controller) {
            controllers.push(buildDiscoveryController(options.controller.guards));
        }

        const providers: Provider[] = [
            { provide: DISCOVERY_APP_INFO_TOKEN, useValue: options.app },
            {
                provide: DISCOVERY_SNAPSHOT_PATH_TOKEN,
                useValue: options.snapshotPath ?? null,
            },
            DiscoveryScanner,
            {
                provide: DISCOVERY_SNAPSHOT_TOKEN,
                useFactory: (scanner: DiscoveryScanner): DiscoverySnapshot => scanner.getSnapshot(),
                inject: [DiscoveryScanner],
            },
        ];

        return {
            module: DiscoveryModule,
            imports: [NestDiscoveryModule, ...(options.imports ?? [])],
            controllers,
            providers,
            exports: [DiscoveryScanner, DISCOVERY_SNAPSHOT_TOKEN],
            global: isGlobal,
        };
    }
}
