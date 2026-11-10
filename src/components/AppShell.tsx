import Link from 'next/link';
import { useRouter } from 'next/router';
import { ReactNode, useEffect, useState } from 'react';
import Avatar from './Avatar';
import { useUserAvatar } from '../hooks/useUserAvatar';

const NAV: Array<{ href: string; label: string; short?: string }> = [
  { href: '/dashboard', label: 'Lobby' },
  { href: '/tournaments', label: 'Tournaments' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/stats', label: 'Results' },
  { href: '/history', label: 'Hand history', short: 'History' },
];

/** The app's mark: a spade on a felt tile. */
export function BrandMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center justify-center rounded-lg bg-linear-to-br from-emerald-500 to-emerald-700 shadow-xs ring-1 ring-inset ring-white/15 ${className}`}>
      <svg viewBox="0 0 24 24" className="h-[55%] w-[55%] text-white" fill="currentColor" aria-hidden="true">
        <path d="M12 2.5c-2.6 3.4-7 6-7 9.6 0 2.2 1.7 3.9 3.8 3.9 1.3 0 2.3-.6 2.9-1.4-.3 2.2-1.2 3.8-2.5 5h5.6c-1.3-1.2-2.2-2.8-2.5-5 .6.8 1.6 1.4 2.9 1.4 2.1 0 3.8-1.7 3.8-3.9 0-3.6-4.4-6.2-7-9.6z" />
      </svg>
    </span>
  );
}

/** The signed-in user's name as stored at login, or null for guests. */
export function useStoredUsername(): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('user');
      const user = raw ? JSON.parse(raw) : null;
      setName(user?.username || null);
    } catch {
      setName(null);
    }
  }, []);
  return name;
}

/**
 * Top navigation shared by the lobby and every account page, so moving around the app always
 * looks the same. The table itself uses its own full-bleed layout.
 */
export default function AppShell({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  const router = useRouter();
  const username = useStoredUsername();
  const { avatarData } = useUserAvatar('me');
  const pathname = router?.pathname || '';
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-gray-200/80 bg-white/80 backdrop-blur-md dark:border-white/6 dark:bg-gray-900/75">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/dashboard" className="flex items-center gap-2.5 shrink-0" aria-label="Table lobby">
            <BrandMark className="h-7 w-7" />
            <span className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-white">Table</span>
          </Link>
          <nav className="hidden md:flex items-center gap-1" aria-label="Main">
            {NAV.map(item => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item.href) ? 'page' : undefined}
                className={`h-8 px-3 inline-flex items-center rounded-md text-sm font-medium transition-colors ${
                  isActive(item.href)
                    ? 'bg-gray-100 text-gray-900 dark:bg-white/[0.07] dark:text-white'
                    : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {actions}
            {username ? (
              <Link href="/profile" className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-1 sm:pr-3 hover:bg-gray-100 dark:hover:bg-white/6 transition-colors" aria-label="Your profile">
                <Avatar src={avatarData?.url} size="sm" alt="" className="w-7! h-7! ring-1 ring-black/10 dark:ring-white/15" />
                <span className="hidden sm:inline text-sm font-medium text-gray-700 dark:text-gray-200">{username}</span>
              </Link>
            ) : (
              <Link href="/" className="btn btn-secondary btn-sm">Sign in</Link>
            )}
          </div>
        </div>
        {/* Phones get the same links as a scrollable strip */}
        <nav className="md:hidden flex gap-0.5 overflow-x-auto px-2 pb-2 -mt-1 scrollbar-none" aria-label="Main">
          {NAV.map(item => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? 'page' : undefined}
              className={`h-8 px-2 inline-flex shrink-0 items-center rounded-md text-[13px] font-medium ${
                isActive(item.href)
                  ? 'bg-gray-100 text-gray-900 dark:bg-white/[0.07] dark:text-white'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {item.short || item.label}
            </Link>
          ))}
        </nav>
      </header>
      {children}
    </div>
  );
}

/** Title row used at the top of each page. */
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
