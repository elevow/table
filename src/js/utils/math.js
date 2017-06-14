
function randomInt (max, min) {
    if (max === undefined) {
        return Math.floor((Math.random() * Number.MAX_SAFE_INTEGER) + 0);
    }
    if (min === undefined) {
        min = 0;
    }
    if ((max - min) <= 0) {
        console.error('Min cannot equal or greater than Max');
        return null;
    }
    return Math.floor(Math.random() * (max - min) + min);
}


export default {
    randomInt,
}