import { generateUniqueRoomCode, isValidRoomCode } from '../../utils/room-code-generator';

describe('room-code-generator import', () => {
  it('generates valid code', () => {
    const code = generateUniqueRoomCode();
    expect(isValidRoomCode(code)).toBe(true);
  });
});
