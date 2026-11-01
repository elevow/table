jest.mock('../../database/pool', () => ({ getPool: () => ({ query: jest.fn() }) }));

import {
  canEnterRoom, formatInviteCode, isPrivateRoom, isRoomMember, newInviteCode, normalizeInviteCode,
  stripPrivacyKeys, withoutPrivateFields,
} from '../room-privacy';

const access = (userId: string | null, permissions: string[] = []) => ({ userId, permissions: new Set(permissions) });
const privateRoom = { createdBy: 'host', configuration: { visibility: 'private', inviteCode: 'K7QM2XPAHR', members: ['member'] } };

describe('invite codes', () => {
  test('are 10 characters without look-alikes, shown with a dash', () => {
    for (let i = 0; i < 50; i++) expect(newInviteCode()).toMatch(/^[2-9A-HJKMNP-Z]{10}$/);
    expect(formatInviteCode('K7QM2XPAHR')).toBe('K7QM2-XPAHR');
  });

  test('accept what people type or paste, and reject anything else', () => {
    expect(normalizeInviteCode('k7qm2-xpahr')).toBe('K7QM2XPAHR');
    expect(normalizeInviteCode(' K7QM2 XPAHR ')).toBe('K7QM2XPAHR');
    expect(normalizeInviteCode('A7x2mK9P')).toBeNull(); // a room id
    expect(normalizeInviteCode('K7QM2-XPAH0')).toBeNull(); // 0 is never used
    expect(normalizeInviteCode(42)).toBeNull();
  });
});

describe('canEnterRoom', () => {
  test('anyone, signed in or not, may enter a public room, including rooms from before privacy existed', () => {
    expect(canEnterRoom(null, { createdBy: 'host', configuration: { visibility: 'public' } })).toBe(true);
    expect(canEnterRoom(null, { createdBy: 'host', configuration: null })).toBe(true);
    expect(isPrivateRoom({})).toBe(false);
  });

  test('a private room admits its host, its members and staff with table.view_private', () => {
    expect(canEnterRoom(access('host'), privateRoom)).toBe(true);
    expect(canEnterRoom(access('member'), privateRoom)).toBe(true);
    expect(canEnterRoom(access('staff', ['table.view_private']), privateRoom)).toBe(true);
  });

  test('and nobody else', () => {
    expect(canEnterRoom(null, privateRoom)).toBe(false);
    expect(canEnterRoom(access(null, ['table.view_private']), privateRoom)).toBe(false);
    expect(canEnterRoom(access('stranger', ['table.join', 'table.join_private']), privateRoom)).toBe(false);
    expect(isRoomMember({ members: 'member' }, 'member')).toBe(false);
  });
});

describe('configuration fields', () => {
  test('the invite code and member list are hidden from everyone but the host', () => {
    expect(withoutPrivateFields({ ...privateRoom.configuration, variant: 'omaha' })).toEqual({ visibility: 'private', variant: 'omaha' });
    expect(withoutPrivateFields(null)).toBeNull();
  });

  test('a client can\'t set who may enter', () => {
    expect(stripPrivacyKeys({ variant: 'omaha', visibility: 'private', inviteCode: 'X', members: ['me'] })).toEqual({ variant: 'omaha' });
    expect(stripPrivacyKeys(undefined)).toEqual({});
    expect(stripPrivacyKeys(['x'])).toEqual({});
  });
});
