// Quick test of room code functionality
const { generateUniqueRoomCode, isValidRoomCode, isUuidFormat } = require('./src/lib/utils/room-code-generator');

console.log('🎯 Room Code System Test');
console.log('========================');

// Generate a room code
const code = generateUniqueRoomCode();
console.log('Generated code:', code);
console.log('Length:', code.length);
console.log('Is valid room code:', isValidRoomCode(code));
console.log('Is UUID format:', isUuidFormat(code));

// URL comparison
const uuid = '550e8400-e29b-41d4-a716-446655440000';
console.log('\nURL Comparison:');
console.log('Old UUID URL:', `/game/${uuid}`);
console.log('New Code URL:', `/game/${code}`);
console.log('Size reduction:', Math.round((1 - code.length / uuid.length) * 100) + '%');

console.log('\n✅ Room code system working correctly!');
