import type { DynamicModule } from '@nestjs/common';
import type {
    SubscriberJoinRepository,
    SubscriberRepository,
    TransactionRunner,
} from '@saasicat/core';

import type { ProviderSpec } from '../../core/di.js';
import { SubscriberJoinModule } from '../../subscriber/subscriber-join.module.js';

import { optionsOf, type CompositionContext } from './context.js';
import { subscriberRepositoryOf } from './subscriber-admin.js';

/** The join repository and the transaction it runs on, where the installation keeps joins. */
function subscriberJoinsOf(ctx: Pick<CompositionContext, 'options' | 'persistence' | 'adapters'>):
    | {
          repository: ProviderSpec<SubscriberJoinRepository>;
          subscriberRepository: ProviderSpec<SubscriberRepository>;
          transactionRunner: ProviderSpec<TransactionRunner>;
      }
    | undefined {
    const repository = ctx.persistence?.entitlement?.subscriberJoinRepository;
    const transactionRunner = ctx.adapters.transactionRunner;
    const subscriberRepository = subscriberRepositoryOf(ctx);
    if (!repository || !transactionRunner || !subscriberRepository) return undefined;
    return {
        // SAFETY: a persistence provider is a value or a factory with the
        // tokens it injects — what `asProvider` takes; only the factory's
        // parameter list is typed `never[]` where Nest's is `any[]`.
        repository: repository as ProviderSpec<SubscriberJoinRepository>,
        subscriberRepository,
        transactionRunner,
    };
}

/**
 * Whether a returning customer's subscriber can be joined into the one it had:
 * the persistence keeps joins, subscribers and transactions. The command line
 * asks this; the administration asks it beside whether it serves subscribers.
 */
export function servesSubscriberJoins(
    ctx: Pick<CompositionContext, 'options' | 'persistence' | 'adapters'>,
): boolean {
    return subscriberJoinsOf(ctx) !== undefined;
}

/**
 * `SubscriberJoinModule`, where joins are kept. Runs before
 * `composeSubscriberAdmin`, which imports the module it leaves in
 * `ctx.shared` for the operator's routes.
 */
export function composeSubscriberJoins(ctx: CompositionContext): DynamicModule[] {
    const joins = subscriberJoinsOf(ctx);
    if (!joins) return [];
    const module = SubscriberJoinModule.forRoot({
        subscriberJoinRepository: joins.repository,
        subscriberRepository: joins.subscriberRepository,
        transactionRunner: joins.transactionRunner,
        imports: optionsOf(ctx.options.subscriptionContract).imports ?? ctx.options.imports ?? [],
    });
    ctx.shared.subscriberJoinModule = module;
    return [module];
}
