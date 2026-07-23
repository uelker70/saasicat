import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import type { PromoCode } from '@prisma/client';
import { SuperAdminGuard } from '@saasicat/nest/admin';

import { CreatePromoCodeDto, UpdatePromoCodeDto } from './admin-pages.dto';
import { NotesPlatformPagesService } from './notes-platform-pages.service';

/**
 * App-owned promo-code CRUD for the SuperAdmin `PromoCodesPage`. The platform
 * ships only the public `POST /billing/promo/preview` controller and no admin
 * CRUD surface (its `PromoCodesService` is not wired into this example), so —
 * as autohauspro does — the admin list/create/update/soft-delete run straight
 * over the app's Prisma `PromoCode` table via `NotesPlatformPagesService`.
 */
interface AdminRequest {
    user: { userId: string; tenantId: string; platformRole?: string };
}

@Controller('admin/promo-codes')
@UseGuards(SuperAdminGuard)
export class NotesPromoCodesController {
    constructor(private readonly pages: NotesPlatformPagesService) {}

    @Get()
    list(@Query() query: { status?: string; search?: string }): Promise<PromoCode[]> {
        return this.pages.listPromoCodes({ status: query.status, search: query.search });
    }

    @Post()
    create(@Req() req: AdminRequest, @Body() dto: CreatePromoCodeDto): Promise<PromoCode> {
        return this.pages.createPromoCode(dto, req.user.userId);
    }

    @Patch(':id')
    update(
        @Req() req: AdminRequest,
        @Param('id') id: string,
        @Body() dto: UpdatePromoCodeDto,
    ): Promise<PromoCode> {
        return this.pages.updatePromoCode(id, dto, req.user.userId);
    }

    @Delete(':id')
    remove(@Req() req: AdminRequest, @Param('id') id: string): Promise<{ ok: true }> {
        return this.pages.deletePromoCode(id, req.user.userId);
    }
}
