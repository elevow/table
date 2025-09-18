import { 
  generateUniqueRoomCode, 
  generateShortRoomCode, 
  isValidRoomCode, 
  isUuidFormat 
} from '../room-code-generator';

describe('Room Code Generator', () => {
  describe('generateUniqueRoomCode', () => {
    it('generates 8-character codes', () => {
      const code = generateUniqueRoomCode();
      expect(code).toHaveLength(8);
      expect(typeof code).toBe('string');
    });

    it('generates unique codes on multiple calls', () => {
      const codes = new Set();
      for (let i = 0; i < 100; i++) {
        codes.add(generateUniqueRoomCode());
      }
      // Should have 100 unique codes (very high probability)
      expect(codes.size).toBe(100);
    });

    it('uses only allowed characters', () => {
      const code = generateUniqueRoomCode();
      const allowedChars = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz]+$/;
      expect(code).toMatch(allowedChars);
    });

    it('excludes confusing characters', () => {
      const codes = Array.from({ length: 50 }, () => generateUniqueRoomCode());
      const allChars = codes.join('');
      
      // Should not contain 0, O, 1, l, I
      expect(allChars).not.toContain('0');
      expect(allChars).not.toContain('O');
      expect(allChars).not.toContain('1');
      expect(allChars).not.toContain('l');
      expect(allChars).not.toContain('I');
    });
  });

  describe('generateShortRoomCode', () => {
    it('generates 6-character codes', () => {
      const code = generateShortRoomCode();
      expect(code).toHaveLength(6);
      expect(typeof code).toBe('string');
    });

    it('uses only allowed characters', () => {
      const code = generateShortRoomCode();
      const allowedChars = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz]+$/;
      expect(code).toMatch(allowedChars);
    });
  });

  describe('isValidRoomCode', () => {
    it('accepts valid 8-character codes', () => {
      expect(isValidRoomCode('A7x2mK9P')).toBe(true);
      expect(isValidRoomCode('23456789')).toBe(true);
      expect(isValidRoomCode('abcdefgh')).toBe(true);
    });

    it('accepts valid 6-character codes', () => {
      expect(isValidRoomCode('A7x2mK')).toBe(true);
      expect(isValidRoomCode('234567')).toBe(true);
      expect(isValidRoomCode('abcdef')).toBe(true);
    });

    it('rejects invalid lengths', () => {
      expect(isValidRoomCode('A7x2m')).toBe(false); // 5 chars
      expect(isValidRoomCode('A7x2mK9PA')).toBe(false); // 9 chars
      expect(isValidRoomCode('')).toBe(false); // empty
    });

    it('rejects codes with disallowed characters', () => {
      expect(isValidRoomCode('A7x2mK0P')).toBe(false); // contains 0
      expect(isValidRoomCode('A7x2mKOP')).toBe(false); // contains O
      expect(isValidRoomCode('A7x2mK1P')).toBe(false); // contains 1
      expect(isValidRoomCode('A7x2mKlP')).toBe(false); // contains l
      expect(isValidRoomCode('A7x2mKIP')).toBe(false); // contains I
      expect(isValidRoomCode('A7x2mK!P')).toBe(false); // contains !
    });

    it('handles null/undefined gracefully', () => {
      expect(isValidRoomCode(null as any)).toBe(false);
      expect(isValidRoomCode(undefined as any)).toBe(false);
      expect(isValidRoomCode(123 as any)).toBe(false);
    });
  });

  describe('isUuidFormat', () => {
    it('recognizes valid UUIDs', () => {
      expect(isUuidFormat('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(isUuidFormat('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true);
    });

    it('rejects invalid UUID formats', () => {
      expect(isUuidFormat('A7x2mK9P')).toBe(false);
      expect(isUuidFormat('550e8400-e29b-41d4-a716-44665544000')).toBe(false); // too short
      expect(isUuidFormat('550e8400-e29b-41d4-a716-4466554400000')).toBe(false); // too long
      expect(isUuidFormat('550e8400-e29b-41d4-a716-44665544000G')).toBe(false); // invalid char
    });

    it('handles null/undefined gracefully', () => {
      expect(isUuidFormat(null as any)).toBe(false);
      expect(isUuidFormat(undefined as any)).toBe(false);
      expect(isUuidFormat(123 as any)).toBe(false);
    });
  });

  describe('integration with real generators', () => {
    it('generated codes pass validation', () => {
      for (let i = 0; i < 20; i++) {
        const code8 = generateUniqueRoomCode();
        const code6 = generateShortRoomCode();
        
        expect(isValidRoomCode(code8)).toBe(true);
        expect(isValidRoomCode(code6)).toBe(true);
        expect(isUuidFormat(code8)).toBe(false);
        expect(isUuidFormat(code6)).toBe(false);
      }
    });
  });
});
