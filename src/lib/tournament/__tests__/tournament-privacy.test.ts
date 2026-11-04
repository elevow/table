import { TournamentManager } from '../tournament-manager';
import { MemoryTournamentStore } from '../tournament-store';
import { createDefaultFreezeoutConfig } from '../tournament-utils';
import {
  canRegisterForTournament, canSeeTournament, directorInviteCode, isPrivateTournament, withoutTournamentInvite,
} from '../tournament-privacy';

const access = (userId: string | null, permissions: string[] = []) => ({ userId, permissions: new Set(permissions) });

async function setup(visibility?: 'public' | 'private') {
  const mgr = new TournamentManager(new MemoryTournamentStore());
  const t = await mgr.create({ name: 'Home game', config: createDefaultFreezeoutConfig(), createdBy: 'director', visibility });
  return { mgr, id: t.id, t };
}

describe('creating', () => {
  test('a tournament is public unless made private, so older ones stay public', async () => {
    const { t } = await setup();
    expect(isPrivateTournament(t)).toBe(false);
    expect(t.inviteCode).toBeUndefined();
    expect(canSeeTournament(null, t)).toBe(true);
  });

  test('a private tournament gets an invite code and no members yet', async () => {
    const { t } = await setup('private');
    expect(t.visibility).toBe('private');
    expect(t.inviteCode).toMatch(/^[2-9A-HJKMNP-Z]{10}$/);
    expect(t.members).toEqual([]);
    expect(directorInviteCode(t)).toBe(`${t.inviteCode!.slice(0, 5)}-${t.inviteCode!.slice(5)}`);
  });
});

describe('who can see and register for a private tournament', () => {
  test('the director, members and registered players; staff with table.view_private or tournament.manage_any can see it', async () => {
    const { mgr, id } = await setup('private');
    await mgr.addMember(id, 'member');
    const t = (await mgr.get(id))!;
    t.registeredPlayers.push('entrant');
    for (const userId of ['director', 'member', 'entrant']) {
      expect(canSeeTournament(access(userId), t)).toBe(true);
      expect(canRegisterForTournament(access(userId), t)).toBe(true);
    }
    expect(canSeeTournament(access('mod', ['table.view_private']), t)).toBe(true);
    expect(canSeeTournament(access('admin', ['tournament.manage_any']), t)).toBe(true);
    // Seeing isn't registering: staff need table.join_private to register without an invite
    expect(canRegisterForTournament(access('mod', ['table.view_private']), t)).toBe(false);
    expect(canRegisterForTournament(access('staff', ['table.join_private']), t)).toBe(true);
  });

  test('and nobody else, signed in or not, whatever else they may do', async () => {
    const { t } = await setup('private');
    expect(canSeeTournament(null, t)).toBe(false);
    expect(canSeeTournament(access(null, ['table.view_private']), t)).toBe(false);
    const stranger = access('stranger', ['tournament.view', 'tournament.register', 'tournament.create', 'tournament.manage']);
    expect(canSeeTournament(stranger, t)).toBe(false);
    expect(canRegisterForTournament(stranger, t)).toBe(false);
  });

  test('the invite code and members are hidden from everyone but the director', async () => {
    const { t } = await setup('private');
    const hidden = withoutTournamentInvite({ ...t, members: ['m'] });
    expect(hidden).not.toHaveProperty('inviteCode');
    expect(hidden).not.toHaveProperty('members');
    expect(hidden.visibility).toBe('private');
  });
});

describe('invites', () => {
  test('an invite code finds its private tournament, and adding a member is idempotent', async () => {
    const { mgr, id, t } = await setup('private');
    expect((await mgr.findByInviteCode(t.inviteCode!))?.id).toBe(id);
    await mgr.addMember(id, 'm');
    await mgr.addMember(id, 'm');
    expect((await mgr.get(id))!.members).toEqual(['m']);
  });

  test('a public tournament has no invite and takes no members', async () => {
    const { mgr, id } = await setup();
    await mgr.addMember(id, 'm');
    expect((await mgr.get(id))!.members).toBeUndefined();
    await expect(mgr.replaceInviteCode(id)).rejects.toThrow('Only a private tournament has an invite link');
  });

  test('a new invite link retires the old code but keeps everyone already invited', async () => {
    const { mgr, id, t } = await setup('private');
    await mgr.addMember(id, 'm');
    const after = await mgr.replaceInviteCode(id);
    expect(after.inviteCode).not.toBe(t.inviteCode);
    expect(await mgr.findByInviteCode(t.inviteCode!)).toBeNull();
    expect(after.members).toEqual(['m']);
  });

  test('making a tournament public hides its invite, and private again brings the same link back', async () => {
    const { mgr, id, t } = await setup('private');
    const pub = await mgr.setVisibility(id, 'public');
    expect(isPrivateTournament(pub)).toBe(false);
    expect(await mgr.findByInviteCode(t.inviteCode!)).toBeNull();
    const priv = await mgr.setVisibility(id, 'private');
    expect(priv.inviteCode).toBe(t.inviteCode);
  });

  test('a public tournament made private gets an invite link', async () => {
    const { mgr, id } = await setup();
    const t = await mgr.setVisibility(id, 'private');
    expect(t.inviteCode).toMatch(/^[2-9A-HJKMNP-Z]{10}$/);
    expect(t.members).toEqual([]);
  });

  test('joining doesn\'t throw away the director\'s undo, and undoing keeps who joined', async () => {
    const { mgr, id } = await setup('private');
    for (const userId of ['a', 'b', 'c']) await mgr.register({ tournamentId: id, userId });
    await mgr.start(id);
    await mgr.eliminate({ tournamentId: id, userId: 'c' });
    await mgr.addMember(id, 'late');
    expect((await mgr.get(id))!.lastElimination).toBeDefined();
    const undone = await mgr.undoElimination(id);
    expect(undone.eliminatedPlayers).toEqual([]);
    expect(undone.members).toEqual(['late']);
    expect(undone.visibility).toBe('private');
  });
});
