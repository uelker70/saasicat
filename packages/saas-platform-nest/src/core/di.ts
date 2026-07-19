// Geteilte DI-Helfer für alle `*.forRoot()`-Module — eine Implementierung statt
// je Modul kopiert. Auch für Extension-Autoren exportiert, die eigene
// `forRoot`-Module gegen das Framework bauen.

import type { FactoryProvider, Provider } from '@nestjs/common';

/**
 * Eine Port-Implementierung kann als fertiger Wert ODER als Factory
 * (`{ useFactory, inject }`) übergeben werden — Konsumenten reichen so ihre
 * Adapter ein, ohne die Instanziierung selbst zu kennen.
 */
export type ProviderSpec<T> = T | Pick<FactoryProvider, 'useFactory' | 'inject'>;

/**
 * Normalisiert eine `ProviderSpec<T>` zu einem Nest-`Provider` für `token`:
 * eine `{ useFactory, inject }`-Form wird zum Factory-Provider, alles andere
 * zum `useValue`-Provider.
 */
export function asProvider<T>(token: symbol, impl: ProviderSpec<T>): Provider {
    if (
        typeof impl === 'object' &&
        impl !== null &&
        'useFactory' in impl &&
        typeof (impl as Pick<FactoryProvider, 'useFactory'>).useFactory === 'function'
    ) {
        const factory = impl as Pick<FactoryProvider, 'useFactory' | 'inject'>;
        return {
            provide: token,
            useFactory: factory.useFactory,
            inject: factory.inject,
        };
    }
    return { provide: token, useValue: impl };
}
