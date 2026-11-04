import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../../hooks/useSupabaseChatRealtime', () => ({ useSupabaseChatRealtime: () => {} }));

import ChatPanel from '../ChatPanel';

const message = (id: string, senderId: string, senderName: string, text: string) => ({
  id, roomId: 'table-1', senderId, senderName, message: text, isPrivate: false, recipientId: null,
  sentAt: '', isModerated: false, moderatedAt: null, moderatorId: null,
});

let directorId: string | null;
beforeEach(() => {
  localStorage.clear();
  directorId = null;
  (global as any).fetch = jest.fn(async (url: string) => {
    if (url.startsWith('/api/chat/room/list')) {
      // Newest first, as the server sends them
      return { json: async () => ({
        items: [message('m3', 'me', 'me', 'my message'), message('m2', 'td', 'Director Dan', 'Break in 5'), message('m1', 'bob', 'bob', 'spam')],
        directorId,
      }) };
    }
    return { json: async () => ({ items: [] }) };
  });
});

test('a player mutes someone and their messages are hidden, then unmutes them', async () => {
  render(<ChatPanel gameId="table-1" playerId="me" />);
  expect(await screen.findByText('spam')).toBeInTheDocument();
  expect(screen.getByText('bob')).toBeInTheDocument();
  expect(screen.getByText('You')).toBeInTheDocument();
  // Two others to mute; never yourself
  expect(screen.getAllByRole('button', { name: 'Mute' })).toHaveLength(2);

  fireEvent.click(screen.getAllByRole('button', { name: 'Mute' })[0]);
  expect(screen.queryByText('spam')).not.toBeInTheDocument();
  expect(screen.getByText('1 message from muted players hidden')).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem('chatMutedPlayers')!)).toEqual({ bob: 'bob' });

  fireEvent.click(screen.getByRole('button', { name: 'Unmute bob' }));
  expect(screen.getByText('spam')).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem('chatMutedPlayers')!)).toEqual({});
});

test('mutes carry over to other tables', async () => {
  localStorage.setItem('chatMutedPlayers', JSON.stringify({ bob: 'bob' }));
  render(<ChatPanel gameId="table-1" playerId="me" />);
  await screen.findByText('Break in 5');
  expect(screen.queryByText('spam')).not.toBeInTheDocument();
});

test('the tournament director can\'t be muted, even if muted before', async () => {
  directorId = 'td';
  localStorage.setItem('chatMutedPlayers', JSON.stringify({ td: 'Director Dan' }));
  render(<ChatPanel gameId="table-1" playerId="me" />);
  expect(await screen.findByText('Break in 5')).toBeInTheDocument();
  expect(screen.getByText('Director')).toBeInTheDocument();
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Mute' })).toHaveLength(1));
  expect(screen.queryByLabelText('Muted players')).not.toBeInTheDocument();
});
