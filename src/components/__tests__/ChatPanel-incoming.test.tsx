import React from 'react';
import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// Keep the realtime callbacks so the test can deliver messages
let handlers: { onNewMessage: (p: { message: any }) => void };
jest.mock('../../hooks/useSupabaseChatRealtime', () => ({
  useSupabaseChatRealtime: (_room: string, h: any) => { handlers = h; },
}));

import ChatPanel from '../ChatPanel';

const message = (id: string, senderId: string, text: string) => ({
  id, roomId: 'table-1', senderId, senderName: senderId, message: text, isPrivate: false, recipientId: null,
  sentAt: '', isModerated: false, moderatedAt: null, moderatorId: null,
});

beforeEach(() => {
  localStorage.clear();
  (global as any).fetch = jest.fn(async () => ({ json: async () => ({ items: [] }) }));
});

const deliver = (m: ReturnType<typeof message>) => act(() => { handlers.onNewMessage({ message: m }); });

test('counts each message from another player once, but not hand results, muted players or your own', async () => {
  localStorage.setItem('chatMutedPlayers', JSON.stringify({ bob: 'bob' }));
  const onIncoming = jest.fn();
  render(<ChatPanel gameId="table-1" playerId="me" onIncoming={onIncoming} />);
  await screen.findByText('No messages yet.');

  deliver(message('m1', 'alice', 'hi'));
  deliver(message('m1', 'alice', 'hi')); // delivered twice
  deliver(message('m2', 'system', 'alice wins $20'));
  deliver(message('m3', 'bob', 'spam'));
  deliver(message('m4', 'me', 'mine'));
  deliver(message('m5', 'carol', 'gg'));

  expect(onIncoming).toHaveBeenCalledTimes(2);
  expect(screen.getByText('hi')).toBeInTheDocument();
});

test('the heading is left out when embedded in a tab', async () => {
  const { unmount } = render(<ChatPanel gameId="table-1" playerId="me" />);
  expect(await screen.findByRole('heading', { name: 'Chat' })).toBeInTheDocument();
  unmount();
  render(<ChatPanel gameId="table-1" playerId="me" embedded />);
  await screen.findByText('No messages yet.');
  expect(screen.queryByRole('heading', { name: 'Chat' })).not.toBeInTheDocument();
});
