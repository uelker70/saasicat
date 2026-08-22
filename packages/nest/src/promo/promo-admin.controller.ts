import {
    Body,
    type CanActivate,
    Controller,
    Delete,
    Get,
    Inject,
    Param,
    Patch,
    Post,
    Query,
    Req,
    type Type,
    UseGuards,
} from '@nestjs/common';
import type {
    AdminActor,
    CreatePromoCodeData,
    PromoCodeFilter,
    PromoCodeRecord,
    UpdatePromoCodeData,
} from '@saasicat/types';
import { AdminAuditService } from '../admin/admin-audit.service.js';
import { CreatePromoCodeDto, UpdatePromoCodeDto } from './dto/promo-admin.dto.js';
import { PromoCodesService } from './service.js';

interface AdminRequest {
    user?: {
        id?: string;
        userId?: string;
        email?: string;
        sessionId?: string;
    };
}

export function buildPromoCodeAdminController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin/promo-codes')
    @UseGuards(...guards)
    class GeneratedPromoCodeAdminController {
        constructor(
            @Inject(PromoCodesService)
            private readonly promos: PromoCodesService,
            @Inject(AdminAuditService)
            private readonly audit: AdminAuditService,
        ) {}

        @Get()
        findAll(
            @Query() query: { status?: PromoCodeFilter['status']; search?: string },
        ): Promise<PromoCodeRecord[]> {
            return this.promos.findAll(query);
        }

        @Post()
        async create(
            @Req() request: AdminRequest,
            @Body() dto: CreatePromoCodeDto,
        ): Promise<PromoCodeRecord> {
            const actor = actorFromRequest(request);
            const created = await this.promos.create(toCreateData(dto, actor.userId));
            await this.audit.log({
                actor,
                entity: 'PromoCode',
                entityId: created.id,
                action: 'PROMO_CODE_CREATE',
                changes: { code: created.code },
            });
            return created;
        }

        @Patch(':id')
        async update(
            @Req() request: AdminRequest,
            @Param('id') id: string,
            @Body() dto: UpdatePromoCodeDto,
        ): Promise<PromoCodeRecord> {
            const actor = actorFromRequest(request);
            const updated = await this.promos.update(id, toUpdateData(dto));
            await this.audit.log({
                actor,
                entity: 'PromoCode',
                entityId: id,
                action: 'PROMO_CODE_UPDATE',
                changes: { fields: Object.keys(dto) },
            });
            return updated;
        }

        @Delete(':id')
        async remove(@Req() request: AdminRequest, @Param('id') id: string): Promise<{ ok: true }> {
            const actor = actorFromRequest(request);
            await this.promos.softDelete(id);
            await this.audit.log({
                actor,
                entity: 'PromoCode',
                entityId: id,
                action: 'PROMO_CODE_DELETE',
            });
            return { ok: true };
        }
    }

    return GeneratedPromoCodeAdminController;
}

function actorFromRequest(request: AdminRequest): AdminActor {
    const userId = request.user?.id ?? request.user?.userId ?? 'unknown';
    return {
        userId,
        email: request.user?.email ?? `${userId}@unknown`,
        source: 'web',
        context: request.user?.sessionId ?? 'unknown',
    };
}

function toCreateData(dto: CreatePromoCodeDto, createdById: string): CreatePromoCodeData {
    return {
        ...dto,
        validFrom: parseDate(dto.validFrom),
        validUntil: parseDate(dto.validUntil),
        createdById,
    };
}

function toUpdateData(dto: UpdatePromoCodeDto): UpdatePromoCodeData {
    const { validFrom, validUntil, ...fields } = dto;
    const data: UpdatePromoCodeData = fields;
    if (validFrom !== undefined) data.validFrom = parseDate(validFrom);
    if (validUntil !== undefined) data.validUntil = parseDate(validUntil);
    return data;
}

function parseDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}
