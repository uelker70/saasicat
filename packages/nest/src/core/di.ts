// Shared DI helpers for all `*.forRoot()` modules — one implementation instead
// of copying it per module. Also exported for extension authors who build their
// own `forRoot` modules against the framework.

import type { FactoryProvider, Provider } from '@nestjs/common';

/**
 * A port implementation can be passed as a ready-made value OR as a factory
 * (`{ useFactory, inject }`) — this way consumers supply their adapters
 * without needing to know the instantiation themselves.
 */
export type ProviderSpec<T> = T | Pick<FactoryProvider, 'useFactory' | 'inject'>;

/**
 * Normalizes a `ProviderSpec<T>` into a Nest `Provider` for `token`:
 * a `{ useFactory, inject }` form becomes a factory provider, everything else
 * a `useValue` provider.
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
