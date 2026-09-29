import {
    registerDecorator,
    type ValidationArguments,
    type ValidationOptions,
} from 'class-validator';

/** What a `numeric(precision, places)` column can hold. */
export interface AmountColumn {
    /** Digits after the decimal point. */
    places: number;
    /** The largest value the column holds. */
    max: number;
}

/**
 * How many decimal places a number was written with, exponent notation
 * included. `1e-7` is valid JSON for 0.0000001, and counting places by splitting
 * its text at the decimal point finds none — class-validator's
 * `maxDecimalPlaces` then fails with a `TypeError`, and the request with a 500
 * instead of the 400 it was meant to get.
 */
export function decimalPlacesOf(value: number): number {
    const [mantissa = '', exponent = '0'] = String(value).toLowerCase().split('e');
    const fraction = mantissa.split('.')[1]?.length ?? 0;
    return Math.max(0, fraction - Number(exponent));
}

/**
 * An amount the column can store as written: no more places than it keeps and
 * no larger than it holds. Refused here with a message rather than rounded, or
 * overflowing, on its way into the table.
 */
export function IsStorableAmount(column: AmountColumn, options?: ValidationOptions) {
    return function register(target: object, propertyName: string): void {
        registerDecorator({
            name: 'isStorableAmount',
            target: target.constructor,
            propertyName,
            constraints: [column],
            options,
            validator: {
                validate(value: unknown): boolean {
                    return (
                        typeof value === 'number' &&
                        Number.isFinite(value) &&
                        decimalPlacesOf(value) <= column.places &&
                        value <= column.max
                    );
                },
                defaultMessage(args: ValidationArguments): string {
                    return (
                        `${args.property} must be a number with at most ${column.places} ` +
                        `decimal places and at most ${column.max}`
                    );
                },
            },
        });
    };
}
