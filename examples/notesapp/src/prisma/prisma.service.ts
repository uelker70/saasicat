import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Standard NestJS Prisma service. Because the schema contains the canonical
 * platform tables, this class structurally satisfies the `PrismaLike`
 * interface of `@saasicat/adapter-prisma` — `prismaPersistence({ client:
 * PrismaService })` needs nothing else.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    async onModuleInit(): Promise<void> {
        await this.$connect();
    }

    async onModuleDestroy(): Promise<void> {
        await this.$disconnect();
    }
}
