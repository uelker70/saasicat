import type { DynamicModule } from '@nestjs/common';

import {
    SubscriberAdminModule,
    type SubscriberAdminModuleOptions,
} from '../../subscriber/subscriber-admin.module.js';

import { adminResourceGuards } from './admin-resources.js';
import { optionsOf, type CompositionContext } from './context.js';

/** The subscriber repository the platform reads subscribers from, where it has one. */
function subscriberRepositoryOf(
    ctx: Pick<CompositionContext, 'options' | 'persistence'>,
): SubscriberAdminModuleOptions['subscriberRepository'] | undefined {
    return (optionsOf(ctx.options.subscriptionContract).subscriberRepository ??
        ctx.persistence?.entitlement?.subscriberRepository) as
        SubscriberAdminModuleOptions['subscriberRepository'] | undefined;
}

/**
 * Whether the operator is offered a tenant's subscriber: the administration
 * shows tenants and subscribers are kept. The route and the capability that
 * announces it both ask this, so neither can exist without the other.
 */
export function servesSubscriberAdmin(
    ctx: Pick<CompositionContext, 'options' | 'persistence'>,
): boolean {
    return Boolean(ctx.options.adminResources && subscriberRepositoryOf(ctx));
}

/**
 * The operator's routes about a tenant's subscriber, beside the tenant's
 * detail — its view and history, the question which tenants of a list hold
 * their subscriber back, and the corrections of its tax identity.
 *
 * Runs after `composeAdminResources` and imports the module it built: the
 * tenant lookup is its.
 */
export function composeSubscriberAdmin(ctx: CompositionContext): DynamicModule[] {
    const { adminResourcesModule } = ctx.shared;
    const subscriberRepository = subscriberRepositoryOf(ctx);
    if (!servesSubscriberAdmin(ctx) || !adminResourcesModule || !subscriberRepository) {
        return [];
    }
    return [
        SubscriberAdminModule.forRoot({
            guards: adminResourceGuards(ctx.options),
            subscriberRepository,
            imports: [
                adminResourcesModule,
                ...(optionsOf(ctx.options.adminResources).imports ?? ctx.options.imports ?? []),
            ],
        }),
    ];
}
