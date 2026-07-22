import { Controller, Get, UseGuards } from '@nestjs/common';
import { SuperAdminGuard } from '@saasicat/nest/admin';

import { PrismaService } from '../prisma/prisma.service';

/**
 * App-owned KPI endpoints for the SuperAdmin dashboard.
 *
 * The platform ships `/admin/stats/dashboard` for the generic
 * subscription/promo/audit aggregates, but that needs the V3 tables this
 * example does not carry. KPI data sources are app domains anyway — the
 * manifest declares the endpoint, the app decides what it returns.
 *
 * `{ value, sub }` is the shape the platform DashboardPage reads by default.
 */
@Controller('admin/stats')
@UseGuards(SuperAdminGuard)
export class AdminStatsController {
    constructor(private readonly prisma: PrismaService) {}

    @Get('tenants')
    async tenants(): Promise<{ value: number; sub: string }> {
        const [total, active] = await Promise.all([
            this.prisma.tenant.count(),
            this.prisma.tenant.count({ where: { isActive: true } }),
        ]);
        return { value: total, sub: `${active} aktiv` };
    }

    @Get('notes')
    async notes(): Promise<{ value: number }> {
        return { value: await this.prisma.note.count() };
    }

    @Get('users')
    async users(): Promise<{ value: number }> {
        return { value: await this.prisma.user.count() };
    }
}
