// Brand presentation of the login and first-run cards: what the public boot
// endpoint reports, falling back to the branding the app configured.
//
// Pure projections, kept out of the SFC so they can be tested without a DOM —
// and so the guards below cannot quietly go missing again. A boot response
// whose `project` is absent used to throw here and take the whole card with it
// on the next render.

/** The slice of the public boot response these cards read. */
export interface LoginBootProject {
    displayName?: string | null;
    label?: string | null;
    icon?: string | null;
    logoUrl?: string | null;
    environment?: string | null;
}

/** App-configured branding, used wherever boot says nothing. */
export interface LoginBrandFallback {
    name?: string;
    tag?: string;
    logoText?: string;
}

export interface LoginBranding {
    name: string;
    tag: string;
    icon: string;
    logoUrl: string | null;
    /** Environment worth showing, i.e. anything but production. `null` hides it. */
    environment: string | null;
}

const DEFAULT_TAG = 'SuperAdmin';

/**
 * `boot` is whatever the endpoint returned — possibly `null`, possibly an
 * object without `project`. Both are treated as "boot said nothing" rather
 * than as a reason to fail.
 */
export function resolveLoginBranding(
    boot: { project?: LoginBootProject | null } | null | undefined,
    fallback: LoginBrandFallback = {},
): LoginBranding {
    const project = boot?.project ?? null;
    const environment = project?.environment ?? null;
    return {
        name: project?.displayName || fallback.name || '',
        tag: project?.label || fallback.tag || DEFAULT_TAG,
        icon: project?.icon || fallback.logoText || '',
        logoUrl: project?.logoUrl || null,
        environment: environment && environment !== 'production' ? environment : null,
    };
}

/** Test credentials must never be printed in production, whatever boot omits. */
export function isProductionBoot(
    boot: { project?: LoginBootProject | null } | null | undefined,
): boolean {
    return boot?.project?.environment === 'production';
}
