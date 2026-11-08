import { render, screen } from '@testing-library/react';
import TableCard from '../TableCard';

describe('TableCard', () => {
  it('shows the rank in the corner and one large suit on the face, named for screen readers', () => {
    render(<TableCard card={{ rank: 'Q', suit: 'hearts' }} />);
    const card = screen.getByRole('img', { name: 'Q of hearts' });
    expect(card.textContent).toBe('Q♥');
    expect(card.className).toContain('text-red-600');
  });

  it('colours by suit in four-colour mode and passes extra classes through', () => {
    render(<TableCard card={{ rank: '10', suit: 'clubs' }} highContrast size="lg" className="top-2" title="Face down" />);
    const card = screen.getByRole('img', { name: '10 of clubs' });
    expect(card.className).toContain('text-blue-600');
    expect(card.className).toContain('w-14');
    expect(card.className).toContain('top-2');
    expect(card.getAttribute('title')).toBe('Face down');
  });
});
