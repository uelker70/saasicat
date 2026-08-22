import { Injectable } from '@nestjs/common';
import { DefinesQuota } from '@saasicat/nest/discovery';
import type { QuotaProvider } from '@saasicat/types';

import { PrismaService } from '../prisma/prisma.service';

/**
 * What is countable, and how to count it.
 *
 * The decorator is the single source of truth — discovery reads it at boot and
 * the quota becomes reviewable in the SuperAdmin UI. `count()` is what
 * `@EnforceQuota('__QUOTA_KEY__')` calls at request time, so it has to be cheap.
 */
@Injectable()
@DefinesQuota({
    key: '__QUOTA_KEY__',
    label: '__QUOTA_LABEL__',
    unit: 'count',
    // continuous | monthlyReset | hardCap — hardCap refuses at the limit.
    policy: 'hardCap',
    feature: '__FEATURE_KEY__',
})
export class __QUOTA_CLASS__ implements QuotaProvider {
    readonly key = '__QUOTA_KEY__';

    constructor(private readonly prisma: PrismaService) {}

    async count(tenantId: string): Promise<number> {
        return this.prisma.__QUOTA_MODEL__.count({ where: { tenantId } });
    }
}
