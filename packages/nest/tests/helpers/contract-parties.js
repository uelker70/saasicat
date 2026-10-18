// The parties a test contract is concluded with, named as the test needs.

/** The issuer every contract is concluded with, as the file names it. */
export const ISSUER_PARTY = {
    legalName: 'Example Software GmbH',
    vatId: 'DE987654321',
    taxNumber: null,
    addressLine1: 'Werkstraße 5',
    addressLine2: null,
    postalCode: '80331',
    city: 'München',
    country: 'DE',
};

/**
 * A subscriber with nothing but its legal name, and the issuer — or none, for a
 * contract concluded before a contract needed one.
 */
export function partiesNamed(legalName, { issuer = ISSUER_PARTY } = {}) {
    return {
        subscriberId: 'subscriber-t1',
        subscriber: {
            customerNumber: '10001',
            legalName,
            vatId: null,
            taxNumber: null,
            addressLine1: null,
            addressLine2: null,
            postalCode: null,
            city: null,
            country: null,
        },
        issuer: issuer && { ...issuer },
    };
}
