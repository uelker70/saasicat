// The parties a test contract is concluded with, named as the test needs.

/** A subscriber with nothing but its legal name, and no issuer. */
export function partiesNamed(legalName) {
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
        issuer: null,
    };
}
