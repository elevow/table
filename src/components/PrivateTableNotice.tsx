import React, { useState } from 'react';
import Link from 'next/link';
import { authHeaders } from '../utils/auth-headers';
import { inviteDestination } from '../utils/invite-destination';

/**
 * Shown in place of a private table or tournament to someone who isn't allowed in: they can enter
 * the invite code the host or director gave them, or go back to the dashboard.
 */
export default function PrivateTableNotice({ kind = 'table' }: { kind?: 'table' | 'tournament' }) {
  const what = kind === 'tournament' ? 'tournament' : 'table';
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signedIn = typeof window !== 'undefined' && !!authHeaders().Authorization;

  const join = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch('/api/games/rooms/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ code }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setError(data?.error || 'That code didn\'t work');
        return;
      }
      // A full load, so every part of the page fetches again now that they're allowed in
      window.location.href = inviteDestination(data) || '/dashboard';
    } catch {
      setError('That code didn\'t work');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg bg-white dark:bg-gray-800 shadow-md p-6 text-gray-900 dark:text-gray-100">
        <h1 className="text-xl font-semibold mb-2">This {what} is private</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
          {kind === 'tournament'
            ? "Only people with the director's invite link can see or register for this tournament."
            : "Only people with the host's invite link can watch or play here."}
          {signedIn ? ' If you have the invite code, enter it below.' : ' Sign in, then open the invite link again.'}
        </p>
        {signedIn && (
          <form onSubmit={join} className="flex gap-2 mb-3">
            <input
              aria-label="Invite code"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="XXXXX-XXXXX"
              className="flex-1 px-3 py-2 rounded-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700"
            />
            <button
              type="submit"
              disabled={busy || !code.trim()}
              className="px-4 py-2 rounded-md text-white bg-indigo-500 hover:bg-indigo-600 disabled:opacity-60"
            >
              {busy ? 'Joining…' : 'Join'}
            </button>
          </form>
        )}
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}
        <Link href={signedIn ? '/dashboard' : '/'} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
          {signedIn ? 'Back to the dashboard' : 'Sign in'}
        </Link>
      </div>
    </div>
  );
}
