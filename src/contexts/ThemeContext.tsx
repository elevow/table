import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useHydrated } from '../hooks/useHydrated';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem('theme');
    return stored === 'light' || stored === 'dark' ? stored : null;
  } catch {
    return null; // localStorage unavailable (e.g. blocked in private mode)
  }
}

interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  // The theme picked here, else the stored one (read once hydrated), else dark
  const [picked, setPicked] = useState<Theme | null>(null);
  const hydrated = useHydrated();
  const theme: Theme = picked ?? (hydrated ? readStoredTheme() : null) ?? 'dark';

  // Keep the page's dark class in step with the theme
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setPicked(next);
    try {
      localStorage.setItem('theme', next);
    } catch {
      /* Ignore localStorage errors in SSR/incognito mode */
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
