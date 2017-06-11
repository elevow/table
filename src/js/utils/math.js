
function randomInt (max, min) {
    if (max === undefined) {
        console.error('one value is required: randomInt(max, min)');
        return null;
    }
    if (min === undefined) {
        min = 0;
    }
    return Math.floor(Math.random() * (max - min) + min);
}


export default {
    randomInt,
}