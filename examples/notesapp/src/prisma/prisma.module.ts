import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** @Global so the persistence-bundle factories can inject PrismaService. */
@Global()
@Module({
    providers: [PrismaService],
    exports: [PrismaService],
})
export class PrismaModule {}
