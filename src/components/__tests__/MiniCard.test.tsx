import React from 'react';
import { render, screen } from '@testing-library/react';
import MiniCard from '../MiniCard';

describe('MiniCard', () => {
  it('colours diamonds red by default and yellow with high-contrast cards', () => {
    const { rerender } = render(<MiniCard card={{ rank: 'Q', suit: 'diamonds' } as any} />);
    expect(screen.getByLabelText('Q of diamonds').className).toContain('text-red-600');
    rerender(<MiniCard card={{ rank: 'Q', suit: 'diamonds' } as any} highContrast />);
    expect(screen.getByLabelText('Q of diamonds').className).toContain('text-yellow-500');
  });

  it('gives clubs their own colour only with high-contrast cards', () => {
    const { rerender } = render(<MiniCard card={{ rank: '7', suit: 'clubs' } as any} />);
    expect(screen.getByLabelText('7 of clubs').className).toContain('text-gray-900');
    rerender(<MiniCard card={{ rank: '7', suit: 'clubs' } as any} highContrast />);
    expect(screen.getByLabelText('7 of clubs').className).toContain('text-blue-600');
  });
});
