import { FriendInviteRecord, Paginated, FriendRelationshipStatus } from '../types/friend';

// Lightweight client for Friends/Invites Next.js API routes

export async function fetchRelationshipStatus(a: string, b: string, signal?: AbortSignal): Promise<FriendRelationshipStatus> {
  const res = await fetch(`/api/friends/status?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`, { signal });
  if (!res.ok) throw new Error(`Failed to fetch relationship status (${res.status})`);
  return res.json();
}

export async function fetchInvites(userId: string, kind: 'incoming' | 'outgoing' = 'incoming', page = 1, limit = 20, signal?: AbortSignal): Promise<Paginated<FriendInviteRecord>> {
  const params = new URLSearchParams({ userId, kind, page: String(page), limit: String(limit) });
  const res = await fetch(`/api/friends/invites?${params.toString()}`, { signal });
  if (!res.ok) throw new Error(`Failed to fetch invites (${res.status})`);
  return res.json();
}

export async function respondToInvite(inviteId: string, action: 'accept' | 'decline'): Promise<FriendInviteRecord> {
  const res = await fetch('/api/friends/invite-respond', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: inviteId, action })
  });
  if (!res.ok) throw new Error(`Failed to ${action} invite (${res.status})`);
  return res.json();
}

export async function createInvite(inviterId: string, inviteeId: string, roomId: string): Promise<FriendInviteRecord> {
  const res = await fetch('/api/friends/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inviterId, inviteeId, roomId })
  });
  if (!res.ok) throw new Error(`Failed to create invite (${res.status})`);
  return res.json();
}
