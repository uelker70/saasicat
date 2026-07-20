// AdminManifestModule — DI-Wrapper um AdminManifestService + Public-Boot-Controller.
//
// Konsumenten reichen ihre App-spezifische `AdminManifestConfig` (project, build,
// planCatalogSnapshot) als Value oder Factory durch.
//
// Auth-Pattern: Wenn `includeManifestController: true` (Default), MUSS der
// Konsument `guards` setzen — entweder eine konkrete Guard-Liste (z. B.
// `[JwtAuthGuard, SuperAdminGuard]`) oder explizit `[]`, um den Endpoint
// absichtlich auth-frei zu betreiben (CI/Smoke-Test). Ohne explizite Wahl
// wirft `forRoot()` beim Boot, damit kein Konsument versehentlich einen
// ungeschützten Manifest-Endpoint deployt. `reloadGuards` hängt zusätzliche
// Guards ausschließlich an `POST /admin/manifest/reload` (typischerweise
// `MfaGuard`).

import {
    type CanActivate,
    Controller,
    type DynamicModule,
    type FactoryProvider,
    type ForwardReference,
    Get,
    Header,
    Headers,
    HttpCode,
    HttpStatus,
    Inject,
    Module,
    Post,
    type Provider,
    Res,
    type Type,
    UseGuards,
} from '@nestjs/common';
import { ADMIN_MANIFEST_CONFIG, type AdminManifestConfig } from './admin-manifest.config.js';
import {
    AdminManifestService,
    PLATFORM_CORE_CONTRIBUTION_TOKEN,
} from './admin-manifest.service.js';
import { AdminPublicBootController } from './admin-public-boot.controller.js';
import { PLATFORM_CORE_MANIFEST_CONTRIBUTION } from './manifest-core.js';

type ConfigSpec =
    | AdminManifestConfig
    | Pick<FactoryProvider<AdminManifestConfig>, 'useFactory' | 'inject'>;

interface HttpResponseLike {
    header(name: string, value: string): unknown;
    status(code: number): unknown;
}

export interface AdminManifestModuleOptions {
    /** AdminManifestConfig als Value oder via Factory (z. B. mit PLAN_CATALOG_TOKEN-Inject). */
    config: ConfigSpec;
    /**
     * Default `true`. Auf `false` setzen, wenn der Konsument einen eigenen
     * Manifest-Controller mit App-spezifischen Guards komplett selbst registriert.
     */
    includeManifestController?: boolean;
    /**
     * Class-Level-Guards für GET /admin/manifest und POST /admin/manifest/reload,
     * wenn `includeManifestController === true`. PFLICHT — `forRoot()` wirft
     * sonst beim Boot.
     *
     * Übergebe `[]` explizit, wenn der Endpoint absichtlich auth-frei sein
     * soll (z. B. CI-Smoke-Tests, Public-Demo). Damit ist die Wahl im Code
     * sichtbar und nicht stiller Default.
     */
    guards?: Array<Type<CanActivate>>;
    /**
     * Zusätzliche Guards, die NUR auf POST /admin/manifest/reload greifen
     * (typischerweise `MfaGuard`). Werden hinter `guards` in die Chain
     * gestellt. Muss vom Konsumenten als Provider verfügbar gemacht werden.
     */
    reloadGuards?: Array<Type<CanActivate>>;
    /**
     * Default `true`. Wenn aktiv, hängt das Modul `PLATFORM_CORE_MANIFEST_CONTRIBUTION`
     * (StandardPage-Spine, generische Tenant-Actions, Plattform-Audit-Action-Labels)
     * automatisch in den `AdminManifestService` — vor allen App-`register()`-Aufrufen
     * aus `onModuleInit`. Konsumenten ohne SuperAdmin-Bedarf setzen das auf `false`.
     */
    registerPlatformCore?: boolean;
    /**
     * Module, deren Provider im DI-Scope dieses DynamicModules sichtbar sein
     * müssen — typisch: das App-Modul, das den Factory-Inject-Provider
     * (z. B. `AdminManifestConfigFactory`) registriert. Ohne diesen Eintrag
     * kann NestJS 11.1.19 den `inject:[...]` der Config-Factory nicht
     * auflösen (UnknownDependenciesException für ADMIN_MANIFEST_CONFIG).
     */
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
    /** Zusätzliche Provider, die im DynamicModule selbst registriert werden. */
    extraProviders?: Provider[];
    /** Modul global registrieren — Default `false`. */
    global?: boolean;
}

function asConfigProvider(impl: ConfigSpec): Provider {
    if (
        typeof impl === 'object' &&
        impl !== null &&
        'useFactory' in impl &&
        typeof impl.useFactory === 'function'
    ) {
        return {
            provide: ADMIN_MANIFEST_CONFIG,
            useFactory: impl.useFactory,
            inject: impl.inject,
        };
    }
    return { provide: ADMIN_MANIFEST_CONFIG, useValue: impl };
}

/**
 * Baut zur Boot-Zeit eine Controller-Klasse mit den vom Konsumenten
 * konfigurierten Guards. Methoden-Level `@UseGuards(...)` greift in NestJS
 * zusätzlich zur Class-Level-Variante; `reload` bekommt also `guards` +
 * `reloadGuards` in der Chain.
 */
function buildManifestController(
    guards: Array<Type<CanActivate>>,
    reloadGuards: Array<Type<CanActivate>>,
): Type {
    const reloadChain = [...guards, ...reloadGuards];

    @Controller('admin')
    @UseGuards(...guards)
    class GeneratedAdminManifestController {
        // Explizites @Inject statt Type-Reflection: tsup/esbuild emittieren keine
        // `design:paramtypes`-Metadata, sodass Nest den Service-Typ am Constructor
        // sonst nicht auflösen kann.
        constructor(
            @Inject(AdminManifestService) private readonly manifest: AdminManifestService,
        ) {}

        @Get('manifest')
        @Header('Cache-Control', 'private, max-age=60, must-revalidate')
        getManifest(
            @Headers('if-none-match') ifNoneMatch: string | undefined,
            @Res({ passthrough: true }) res: HttpResponseLike,
        ) {
            const m = this.manifest.getManifest();
            const etag = `"${m.build.manifestHash}"`;
            res.header('ETag', etag);

            if (ifNoneMatch && ifNoneMatch === etag) {
                res.status(HttpStatus.NOT_MODIFIED);
                return null;
            }

            return m;
        }

        @Post('manifest/reload')
        @UseGuards(...reloadChain)
        @HttpCode(HttpStatus.OK)
        reload() {
            const m = this.manifest.rebuild();
            return {
                manifestHash: m.build.manifestHash,
                reloadedAt: new Date().toISOString(),
            };
        }
    }

    return GeneratedAdminManifestController;
}

@Module({})
export class AdminManifestModule {
    static forRoot(options: AdminManifestModuleOptions): DynamicModule {
        const includeManifestController = options.includeManifestController ?? true;
        const registerPlatformCore = options.registerPlatformCore ?? true;

        const controllers: Type[] = [AdminPublicBootController];
        if (includeManifestController) {
            if (options.guards === undefined) {
                throw new Error(
                    'AdminManifestModule.forRoot: `guards` ist Pflicht, wenn ' +
                        '`includeManifestController` aktiv ist (Default `true`). ' +
                        'Setze `guards: [JwtAuthGuard, SuperAdminGuard]` (oder ' +
                        'analog) — oder `guards: []`, um den Endpoint absichtlich ' +
                        'auth-frei zu betreiben. Alternative: ' +
                        '`includeManifestController: false` und einen eigenen ' +
                        'Wrapping-Controller registrieren.',
                );
            }
            controllers.push(buildManifestController(options.guards, options.reloadGuards ?? []));
        }

        const providers: Provider[] = [
            asConfigProvider(options.config),
            AdminManifestService,
            ...(options.extraProviders ?? []),
        ];
        if (registerPlatformCore) {
            providers.push({
                provide: PLATFORM_CORE_CONTRIBUTION_TOKEN,
                useValue: PLATFORM_CORE_MANIFEST_CONTRIBUTION,
            });
        }

        return {
            module: AdminManifestModule,
            global: options.global ?? false,
            imports: options.imports ?? [],
            controllers,
            providers,
            exports: [ADMIN_MANIFEST_CONFIG, AdminManifestService],
        };
    }
}
