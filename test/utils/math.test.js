import math from '../../src/js/utils/math';
import {
    expect
} from 'chai';

describe('math.js', () => {
    describe('randomInt function', () => {
        it('will return null if values are same', () => {
            const actualValue = math.randomInt(0, 0);
            // console.log('actualValue', actualValue);
            expect(actualValue).equal(null);
        });

        it('will return null if max is 0 - no min value', () => {
            const actualValue = math.randomInt(0);
            // console.log('actualValue', actualValue);
            expect(actualValue).equal(null);
        });

        it('will not equal the high value', () => {
            const minValue = 11;
            const maxValue = 12;
            const actualValue = math.randomInt(maxValue, minValue);
            // console.log('actualValue', actualValue);
            expect(actualValue).not.equal(maxValue);
            expect(actualValue).to.be.below(maxValue);
        });

        it('will not equal the high value - no min value', () => {
            const maxValue = 12;
            const actualValue = math.randomInt(maxValue);
            // console.log('actualValue', actualValue);
            expect(actualValue).not.equal(maxValue);
            expect(actualValue).to.be.below(maxValue);
        });

        it('will return random number when no value is provided', () => {
            const actualValue = math.randomInt();
            // console.log('actualValue', actualValue);
            expect(actualValue).to.be.above(0);
        });
    });


});