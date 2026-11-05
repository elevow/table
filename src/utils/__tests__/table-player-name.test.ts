/**
 * @jest-environment jsdom
 */
import { tablePlayerName } from '../table-player-name';

describe('tablePlayerName', () => {
  beforeEach(() => localStorage.clear());

  it('uses the name chosen in Account Settings first', () => {
    localStorage.setItem('playerName', 'Ace');
    localStorage.setItem('user', JSON.stringify({ username: 'gene' }));
    expect(tablePlayerName('Player 7')).toBe('Ace');
  });

  it('uses the account username when no name was chosen', () => {
    localStorage.setItem('user', JSON.stringify({ username: 'gene' }));
    expect(tablePlayerName('Player 7')).toBe('gene');
  });

  it('falls back when neither is stored or the saved user is unreadable', () => {
    expect(tablePlayerName('Player 7')).toBe('Player 7');
    localStorage.setItem('user', '{not json');
    expect(tablePlayerName('Player 7')).toBe('Player 7');
  });
});
