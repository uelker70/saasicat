import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Reflector } from '@nestjs/core';
import {
    AdminPublicBootController,
    PromoCodePublicController,
    PublicCatalogController,
    SetupController,
    buildCheckoutOfferController,
    buildPublicMarketingCatalogController,
    isSaaSiCatPublicRoute,
} from '../dist/index.js';

function contextFor(controller) {
    return {
        getClass: () => controller,
        getHandler: () => controller.prototype.constructor,
    };
}

// @requirement SC-MKT-012 — The public catalogue answers even when something behind it is unavailable
// @requirement SC-SEC-004 — Every decision that matters is made where the request is served
describe('SaaSiCat public route metadata', () => {
    const publicControllers = [
        SetupController,
        AdminPublicBootController,
        PublicCatalogController,
        PromoCodePublicController,
        buildCheckoutOfferController([]),
        buildPublicMarketingCatalogController([], 'test-app', 'EUR', 19),
    ];

    for (const controller of publicControllers) {
        test(`${controller.name} is recognized by global auth guards`, () => {
            assert.equal(isSaaSiCatPublicRoute(new Reflector(), contextFor(controller)), true);
        });
    }

    test('unmarked controllers stay protected', () => {
        class ProtectedController {}

        assert.equal(
            isSaaSiCatPublicRoute(new Reflector(), contextFor(ProtectedController)),
            false,
        );
    });
});
