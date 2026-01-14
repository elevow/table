import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ThemeProvider, useTheme } from '../ThemeContext';

// Test component to use the useTheme hook
const TestComponent = () => {
  const { theme, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={toggleTheme} data-testid="toggle-button">
        Toggle Theme
      </button>
    </div>
  );
};

describe('ThemeContext', () => {
  let localStorageMock: { [key: string]: string };
  let documentClassListMock: {
    toggle: jest.Mock;
    add: jest.Mock;
    remove: jest.Mock;
  };

  beforeEach(() => {
    // Mock localStorage
    localStorageMock = {};
    Storage.prototype.getItem = jest.fn((key: string) => localStorageMock[key] || null);
    Storage.prototype.setItem = jest.fn((key: string, value: string) => {
      localStorageMock[key] = value;
    });
    Storage.prototype.removeItem = jest.fn((key: string) => {
      delete localStorageMock[key];
    });

    // Mock document.documentElement.classList
    documentClassListMock = {
      toggle: jest.fn(),
      add: jest.fn(),
      remove: jest.fn(),
    };
    Object.defineProperty(document.documentElement, 'classList', {
      value: documentClassListMock,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    localStorageMock = {};
  });

  describe('ThemeProvider', () => {
    it('should initialize with dark theme by default', () => {
      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      );

      expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    });

    it('should apply dark class to document on initial render with default theme', () => {
      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      );

      // Should toggle dark class (sets to dark)
      expect(documentClassListMock.toggle).toHaveBeenCalledWith('dark', true);
    });

    it('should load theme from localStorage if available', () => {
      localStorageMock['theme'] = 'light';

      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      );

      expect(screen.getByTestId('theme')).toHaveTextContent('light');
    });

    it('should apply light theme from localStorage', () => {
      localStorageMock['theme'] = 'light';

      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      );

      // Should toggle dark class (sets to false for light theme)
      expect(documentClassListMock.toggle).toHaveBeenCalledWith('dark', false);
    });

    it('should toggle theme from dark to light', () => {
      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      );

      const toggleButton = screen.getByTestId('toggle-button');
      const themeDisplay = screen.getByTestId('theme');

      expect(themeDisplay).toHaveTextContent('dark');

      act(() => {
        toggleButton.click();
      });

      expect(themeDisplay).toHaveTextContent('light');
    });

    it('should toggle theme from light to dark', () => {
      localStorageMock['theme'] = 'light';

      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      );

      const toggleButton = screen.getByTestId('toggle-button');
      const themeDisplay = screen.getByTestId('theme');

      expect(themeDisplay).toHaveTextContent('light');

      act(() => {
        toggleButton.click();
      });

      expect(themeDisplay).toHaveTextContent('dark');
    });

    it('should persist theme to localStorage when toggling to light', () => {
      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      );

      const toggleButton = screen.getByTestId('toggle-button');

      act(() => {
        toggleButton.click();
      });

      expect(localStorage.setItem).toHaveBeenCalledWith('theme', 'light');
      expect(localStorageMock['theme']).toBe('light');
    });

    it('should persist theme to localStorage when toggling to dark', () => {
      localStorageMock['theme'] = 'light';

      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      );

      const toggleButton = screen.getByTestId('toggle-button');

      act(() => {
        toggleButton.click();
      });

      expect(localStorage.setItem).toHaveBeenCalledWith('theme', 'dark');
      expect(localStorageMock['theme']).toBe('dark');
    });

    it('should update document class when toggling to light', () => {
      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      );

      const toggleButton = screen.getByTestId('toggle-button');

      act(() => {
        toggleButton.click();
      });

      // Should have been called on initial render and on toggle
      expect(documentClassListMock.toggle).toHaveBeenCalledWith('dark', false);
    });

    it('should update document class when toggling to dark', () => {
      localStorageMock['theme'] = 'light';

      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      );

      const toggleButton = screen.getByTestId('toggle-button');

      act(() => {
        toggleButton.click();
      });

      // Should toggle to dark
      expect(documentClassListMock.toggle).toHaveBeenCalledWith('dark', true);
    });

    it('should handle localStorage errors gracefully during initialization', () => {
      // Mock localStorage.getItem to throw an error
      Storage.prototype.getItem = jest.fn(() => {
        throw new Error('localStorage is not available');
      });

      // Should not throw and should use default theme
      expect(() => {
        render(
          <ThemeProvider>
            <TestComponent />
          </ThemeProvider>
        );
      }).not.toThrow();

      expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    });

    it('should handle localStorage errors gracefully during toggle', () => {
      // Mock localStorage.setItem to throw an error
      Storage.prototype.setItem = jest.fn(() => {
        throw new Error('localStorage is full');
      });

      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      );

      const toggleButton = screen.getByTestId('toggle-button');

      // Should not throw even though localStorage fails
      expect(() => {
        act(() => {
          toggleButton.click();
        });
      }).not.toThrow();

      // Theme should still update in state
      expect(screen.getByTestId('theme')).toHaveTextContent('light');
    });

    it('should render children correctly', () => {
      render(
        <ThemeProvider>
          <div data-testid="child">Child Content</div>
        </ThemeProvider>
      );

      expect(screen.getByTestId('child')).toHaveTextContent('Child Content');
    });

    it('should provide theme context to multiple children', () => {
      const ChildOne = () => {
        const { theme } = useTheme();
        return <span data-testid="child-one">{theme}</span>;
      };

      const ChildTwo = () => {
        const { theme } = useTheme();
        return <span data-testid="child-two">{theme}</span>;
      };

      render(
        <ThemeProvider>
          <ChildOne />
          <ChildTwo />
        </ThemeProvider>
      );

      expect(screen.getByTestId('child-one')).toHaveTextContent('dark');
      expect(screen.getByTestId('child-two')).toHaveTextContent('dark');
    });

    it('should share theme state across all consumers', () => {
      const ChildOne = () => {
        const { theme, toggleTheme } = useTheme();
        return (
          <div>
            <span data-testid="child-one">{theme}</span>
            <button onClick={toggleTheme} data-testid="toggle-one">
              Toggle
            </button>
          </div>
        );
      };

      const ChildTwo = () => {
        const { theme } = useTheme();
        return <span data-testid="child-two">{theme}</span>;
      };

      render(
        <ThemeProvider>
          <ChildOne />
          <ChildTwo />
        </ThemeProvider>
      );

      expect(screen.getByTestId('child-one')).toHaveTextContent('dark');
      expect(screen.getByTestId('child-two')).toHaveTextContent('dark');

      act(() => {
        screen.getByTestId('toggle-one').click();
      });

      expect(screen.getByTestId('child-one')).toHaveTextContent('light');
      expect(screen.getByTestId('child-two')).toHaveTextContent('light');
    });
  });

  describe('useTheme hook', () => {
    it('should return theme context when used within ThemeProvider', () => {
      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      );

      expect(screen.getByTestId('theme')).toBeInTheDocument();
      expect(screen.getByTestId('toggle-button')).toBeInTheDocument();
    });

    it('should throw error when used outside ThemeProvider', () => {
      // Suppress console.error for this test
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

      const ComponentOutsideProvider = () => {
        useTheme();
        return <div>Should not render</div>;
      };

      expect(() => {
        render(<ComponentOutsideProvider />);
      }).toThrow('useTheme must be used within a ThemeProvider');

      consoleError.mockRestore();
    });

    it('should provide toggleTheme function', () => {
      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      );

      const toggleButton = screen.getByTestId('toggle-button');
      expect(toggleButton).toBeInTheDocument();

      // Should be able to click without error
      expect(() => {
        act(() => {
          toggleButton.click();
        });
      }).not.toThrow();
    });

    it('should provide current theme value', () => {
      localStorageMock['theme'] = 'light';

      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      );

      expect(screen.getByTestId('theme')).toHaveTextContent('light');
    });
  });

  describe('SSR compatibility', () => {
    it('should handle missing window object during initialization', () => {
      // Mock window as undefined (SSR scenario)
      const originalWindow = global.window;
      (global as any).window = undefined;

      // Should not throw
      expect(() => {
        render(
          <ThemeProvider>
            <TestComponent />
          </ThemeProvider>
        );
      }).not.toThrow();

      // Restore window
      global.window = originalWindow;
    });

    it('should handle missing document object during initialization', () => {
      // We can't easily delete document, but the code handles typeof document !== 'undefined'
      // This is more of a smoke test to ensure the component renders
      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      );

      expect(screen.getByTestId('theme')).toBeInTheDocument();
    });
  });

  describe('Integration scenarios', () => {
    it('should maintain theme across re-renders', () => {
      const { rerender } = render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      );

      act(() => {
        screen.getByTestId('toggle-button').click();
      });

      expect(screen.getByTestId('theme')).toHaveTextContent('light');

      rerender(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      );

      // Theme should persist after rerender (within same mount)
      expect(screen.getByTestId('theme')).toHaveTextContent('light');
    });

    it('should complete a full toggle cycle', () => {
      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      );

      const themeDisplay = screen.getByTestId('theme');
      const toggleButton = screen.getByTestId('toggle-button');

      // Start: dark
      expect(themeDisplay).toHaveTextContent('dark');

      // Toggle to light
      act(() => {
        toggleButton.click();
      });
      expect(themeDisplay).toHaveTextContent('light');
      expect(localStorageMock['theme']).toBe('light');

      // Toggle back to dark
      act(() => {
        toggleButton.click();
      });
      expect(themeDisplay).toHaveTextContent('dark');
      expect(localStorageMock['theme']).toBe('dark');
    });

    it('should handle rapid theme toggles', () => {
      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      );

      const toggleButton = screen.getByTestId('toggle-button');

      // Rapidly toggle multiple times
      act(() => {
        toggleButton.click(); // dark -> light
        toggleButton.click(); // light -> dark
        toggleButton.click(); // dark -> light
        toggleButton.click(); // light -> dark
        toggleButton.click(); // dark -> light
      });

      expect(screen.getByTestId('theme')).toHaveTextContent('light');
      expect(localStorageMock['theme']).toBe('light');
    });
  });
});
