import {
    registerDecorator,
    type ValidationArguments,
    type ValidationOptions,
} from 'class-validator';

// A quota record, validated at the HTTP boundary rather than trusted.
//
// `@IsObject()` says the container is an object and nothing about what is in
// it, so `{ "users": "100" }` reached the service, the repository and the JSON
// column unchallenged. Two things then went wrong downstream and neither was
// visible here: the regression gate compared `"50"` against `"100"` as strings
// and read a halved allowance as an improvement, and the runtime check for
// "unlimited" is `=== -1`, which `"-1"` is not — so an unlimited quota written
// as a string silently became a limit of one.
//
// The shape it insists on is the one the JSON Schema already states for the
// same field (`plan-catalog.schema.json`, `patternProperties` → `integer`):
// every value an integer, `-1` for unlimited. The import path was validated by
// that schema all along; this is the admin route catching up.

/** -1 = unlimited; 0 = nothing allowed; above that, a ceiling. */
function isQuotaValue(value: unknown): boolean {
    return typeof value === 'number' && Number.isInteger(value) && value >= -1;
}

/** The keys whose value is not a quota, so the message can name them. */
export function offendingQuotaKeys(value: unknown): string[] {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
    return Object.entries(value)
        .filter(([, quota]) => !isQuotaValue(quota))
        .map(([key]) => key)
        .sort();
}

export function IsQuotaRecord(options?: ValidationOptions) {
    return function register(target: object, propertyName: string): void {
        registerDecorator({
            name: 'isQuotaRecord',
            target: target.constructor,
            propertyName,
            options,
            validator: {
                validate(value: unknown): boolean {
                    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
                        return false;
                    }
                    return offendingQuotaKeys(value).length === 0;
                },
                defaultMessage(args: ValidationArguments): string {
                    const bad = offendingQuotaKeys(args.value);
                    if (bad.length === 0) {
                        return `${args.property} must be an object of quota keys to integers`;
                    }
                    return (
                        `${args.property} must map every key to an integer of at least -1 ` +
                        `(-1 = unlimited); not a number: ${bad.join(', ')}`
                    );
                },
            },
        });
    };
}
