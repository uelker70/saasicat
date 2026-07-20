// CheckoutOfferController — REST-Endpunkte für den Paket-Snapshot
// (METAMODELL §17a). Pfad: `/public/checkout-offer`.
//
// Die Endpoints sind **auth-frei** — der Offer entsteht vor der Tenant-
// Anlage (Webseite-Besucher ist noch nicht eingeloggt). Der Konsument
// kann dennoch eigene Guards (z. B. Rate-Limit) übergeben.

import {
    Body,
    type CanActivate,
    Controller,
    Get,
    Inject,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    type Type,
    UseGuards,
} from '@nestjs/common';

import { CheckoutOfferService } from './checkout-offer.service.js';
import { CreateCheckoutOfferDto, UpdateCheckoutOfferDto } from './dto/checkout-offer.dto.js';

export function buildCheckoutOfferController(guards: Array<Type<CanActivate>>): Type {
    @Controller('public/checkout-offer')
    @UseGuards(...guards)
    class GeneratedCheckoutOfferController {
        constructor(
            @Inject(CheckoutOfferService)
            private readonly service: CheckoutOfferService,
        ) {}

        /** Webseite legt beim Paket-Klick einen Offer an. */
        @Post()
        create(@Body() dto: CreateCheckoutOfferDto) {
            return this.service.create(dto);
        }

        /** Onboarding liest den vorgewählten Offer (`?offer=<id>`). */
        @Get(':id')
        getById(@Param('id', new ParseUUIDPipe()) id: string) {
            return this.service.getById(id);
        }

        /** Onboarding-Individualisierung — solange der Offer `open` ist. */
        @Patch(':id')
        update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateCheckoutOfferDto) {
            return this.service.update(id, dto);
        }
    }

    return GeneratedCheckoutOfferController;
}
