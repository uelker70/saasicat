// CheckoutOfferController — REST endpoints for the package snapshot
// (METAMODELL §17a). Path: `/public/checkout-offer`.
//
// The endpoints are **auth-free** — the offer is created before the tenant
// is provisioned (the website visitor is not logged in yet). The consumer
// can still supply its own guards (e.g. rate-limit).

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

        /** The website creates an offer when a package is clicked. */
        @Post()
        create(@Body() dto: CreateCheckoutOfferDto) {
            return this.service.create(dto);
        }

        /** Onboarding reads the pre-selected offer (`?offer=<id>`). */
        @Get(':id')
        getById(@Param('id', new ParseUUIDPipe()) id: string) {
            return this.service.getById(id);
        }

        /** Onboarding customization — as long as the offer is `open`. */
        @Patch(':id')
        update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateCheckoutOfferDto) {
            return this.service.update(id, dto);
        }
    }

    return GeneratedCheckoutOfferController;
}
