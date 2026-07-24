// Navigation labels consumed by the nav-builder: standard-page labels and the
// default drawer section names. Section VALUES double as section identifiers
// in `navSection` / `sectionOrder`, so builder options and catalog must come
// from the same locale.

import type { StandardPageKey } from '@saasicat/types';

import { defineMessages } from '../define.js';
import type { SaLocale } from '../locale.js';

// Type alias (not interface) so the shape keeps an implicit index signature
// and stays assignable to `MessageTree`.
type NavNamespace = {
    readonly pages: Record<StandardPageKey, string>;
    readonly sections: {
        readonly overview: string;
        readonly catalog: string;
        readonly customers: string;
        readonly system: string;
    };
};

export const navMessages: Record<SaLocale, NavNamespace> = defineMessages(
    {
        pages: {
            dashboard: 'Dashboard',
            tenants: 'Mandanten',
            subscriptions: 'Abonnements',
            promoCodes: 'Promo-Codes',
            plans: 'Pläne & Versionen',
            audit: 'Audit-Log',
            users: 'Benutzer',
            pilots: 'Piloten',
            discovery: 'Discovery',
            bundles: 'Bundles',
            marketingCatalog: 'Marketing-Catalog',
            platformEmail: 'Plattform-E-Mail',
            platformEmailHistory: 'E-Mail-Verlauf',
        },
        sections: {
            overview: 'Übersicht',
            catalog: 'Produktkatalog',
            customers: 'Kunden',
            system: 'System',
        },
    },
    {
        pages: {
            dashboard: 'Dashboard',
            tenants: 'Tenants',
            subscriptions: 'Subscriptions',
            promoCodes: 'Promo codes',
            plans: 'Plans & versions',
            audit: 'Audit log',
            users: 'Users',
            pilots: 'Pilots',
            discovery: 'Discovery',
            bundles: 'Bundles',
            marketingCatalog: 'Marketing catalog',
            platformEmail: 'Platform email',
            platformEmailHistory: 'Email history',
        },
        sections: {
            overview: 'Overview',
            catalog: 'Product catalog',
            customers: 'Customers',
            system: 'System',
        },
    },
);
