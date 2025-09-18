#!/usr/bin/env node
/**
 * Room Code Demo Script
 * Demonstrates the new alphanumeric room code system
 */

import { 
  generateUniqueRoomCode, 
  generateShortRoomCode, 
  isValidRoomCode, 
  isUuidFormat 
} from '../src/lib/utils/room-code-generator';

console.log('🎲 Room Code System Demo\n');

// Generate some example room codes
console.log('📱 Generated Room Codes:');
for (let i = 0; i < 5; i++) {
  const code = generateUniqueRoomCode();
  console.log(`   ${code} (8 chars)`);
}

console.log('\n📱 Short Room Codes:');
for (let i = 0; i < 5; i++) {
  const code = generateShortRoomCode();
  console.log(`   ${code} (6 chars)`);
}

// Validation examples
console.log('\n✅ Validation Examples:');
const testCodes = [
  'A7x2mK9P',  // Valid 8-char
  'B3n5Rx',    // Valid 6-char
  'ABC01234',  // Invalid (contains 0 and 1)
  '550e8400-e29b-41d4-a716-446655440000', // UUID format
  'XYZ',       // Invalid (too short)
  'ABCDEFGHI', // Invalid (too long)
];

testCodes.forEach(code => {
  const isRoom = isValidRoomCode(code);
  const isUuid = isUuidFormat(code);
  const status = isRoom ? '✅ Valid Room Code' : isUuid ? '🆔 Legacy UUID' : '❌ Invalid';
  console.log(`   ${code.padEnd(40)} ${status}`);
});

// URL comparison
console.log('\n🔗 URL Comparison:');
const uuid = '550e8400-e29b-41d4-a716-446655440000';
const roomCode = generateUniqueRoomCode();

console.log(`   Before: /game/${uuid}`);
console.log(`   After:  /game/${roomCode}`);
console.log(`   
   📊 Stats:
   - UUID Length: ${uuid.length} chars
   - Room Code Length: ${roomCode.length} chars  
   - Reduction: ${Math.round((1 - roomCode.length / uuid.length) * 100)}%
   - Collision Risk: ~1 in ${Math.pow(58, 8).toLocaleString()} (58^8)
`);

// Character exclusion demonstration
console.log('\n🚫 Excluded Confusing Characters:');
console.log('   Excluded: 0 (zero), O (oh), 1 (one), l (el), I (eye)');
console.log('   Reason: Prevents user confusion when sharing codes');

const sampleCodes = Array.from({ length: 100 }, () => generateUniqueRoomCode()).join('');
const excludedChars = ['0', 'O', '1', 'l', 'I'];
const hasExcluded = excludedChars.some(char => sampleCodes.includes(char));

console.log(`   ✅ Verified: No excluded characters in 100 random codes: ${!hasExcluded}`);

console.log('\n🎯 Perfect for sharing via:');
console.log('   • Text messages');
console.log('   • Voice calls'); 
console.log('   • Social media');
console.log('   • QR codes');
console.log('   • Business cards');
