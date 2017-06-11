import math from '../../src/js/utils/math';
import {
    expect
} from 'chai';

describe('math.js', () => {
    describe('randomInt function', () => {
        it('will return exact value - 0', () => {
            const actualValue = math.randomInt(0, 0);
            // console.log('actualValue', actualValue);
            expect(actualValue).equal(0);
        });

        it('will return exact value - 0 - no min value', () => {
            const actualValue = math.randomInt(0);
            // console.log('actualValue', actualValue);
            expect(actualValue).equal(0);
        });

        it('will return exact value - 1', () => {
            const actualValue = math.randomInt(1, 1);
            // console.log('actualValue', actualValue);
            expect(actualValue).equal(1);
        });

        it('will not equal the high value', () => {
            const minValue = 11;
            const maxValue = 12;
            const actualValue = math.randomInt(maxValue, minValue);
            // console.log('actualValue', actualValue);
            expect(actualValue).not.equal(maxValue);
        });

        it('will not equal the high value - no min value', () => {
            const maxValue = 12;
            const actualValue = math.randomInt(maxValue);
            // console.log('actualValue', actualValue);
            expect(actualValue).not.equal(maxValue);
        });

        it('will return null when no value is provided', () => {
            const actualValue = math.randomInt();
            // console.log('actualValue', actualValue);
            expect(actualValue).equal(null);
        });
    });


});