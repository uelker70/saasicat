// What names a legal entity, and how two of them are compared.
//
// Both parties to a contract have one: the subscriber, and the operator's own
// issuer as `config/saas.yaml` names it. Both are the party a contract was
// concluded with, so both change under a running contract only as a declared
// correction of that same entity — and both ask the same question of the same
// three fields. One list and one comparison, because two of each is how one
// side ends up missing a field the other gained.

/** The address lines a party is named with. Every one of them may be unknown. */
export interface PartyAddress {
    /** Street and number. */
    addressLine1: string | null;
    /** A second line, such as a building or a c/o. */
    addressLine2: string | null;
    postalCode: string | null;
    city: string | null;
    /** ISO 3166-1 alpha-2, upper case. */
    country: string | null;
}

/**
 * What names a legal entity: the name it is registered under and the
 * identifiers its tax office gave it.
 *
 * These are the party a contract was concluded with. Under a running contract
 * they change only as a correction of that same entity, recorded with the
 * values they replaced and the reason; contact details change freely.
 */
export interface LegalIdentity {
    /** The registered name, legal form included. */
    legalName: string;
    /** VAT identification number. */
    vatId: string | null;
    /** The national tax number, where one is stated beside or instead of the VAT id. */
    taxNumber: string | null;
}

/** The fields of the legal identity, the ones a correction may change. */
export type LegalIdentityField = keyof LegalIdentity;

/** Those fields, in the order they are named and shown. */
export const LEGAL_IDENTITY_FIELDS: readonly LegalIdentityField[] = [
    'legalName',
    'vatId',
    'taxNumber',
];

/** Whether two identities name the same entity: every field, value for value. */
export function sameLegalIdentity(before: LegalIdentity, after: LegalIdentity): boolean {
    return LEGAL_IDENTITY_FIELDS.every((field) => before[field] === after[field]);
}

/** The fields whose value differs between two identities, in field order. */
export function movedIdentityFields(
    before: LegalIdentity,
    after: LegalIdentity,
): LegalIdentityField[] {
    return LEGAL_IDENTITY_FIELDS.filter((field) => before[field] !== after[field]);
}
