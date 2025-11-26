const Hand = require('pokersolver').Hand;

const hand1 = Hand.solve(['As','Ks','2h','3h','4c']);
const hand2 = Hand.solve(['Qh','Qc','2d','3c','4h']);

const winners1 = Hand.winners([hand1, hand2]);
console.log('cmp hand1 vs hand2 =>', winners1.length > 1 ? 0 : winners1[0] === hand1 ? 1 : -1);

const winners2 = Hand.winners([hand2, hand1]);
console.log('cmp hand2 vs hand1 =>', winners2.length > 1 ? 0 : winners2[0] === hand2 ? 1 : -1);
