import { useEffect, useState } from 'react';
import Link from 'next/link';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { authHeaders } from '../../src/utils/auth-headers';
import { inviteDestination } from '../../src/utils/invite-destination';

/**
 * /join/K7QM2-XPAHR: a private table's or tournament's invite link. Signs the visitor in first if
 * needed (coming back here afterwards), joins and opens the table or tournament.
 */
export default function JoinByInvitePage() {
  const router = useRouter();
  const code = typeof router.query.code === 'string' ? router.query.code : '';
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!router.isReady || !code) return;
    if (!authHeaders().Authorization) {
      router.replace(`/?next=${encodeURIComponent(`/join/${code}`)}`);
      return;
    }
    let alive = true;
    fetch('/api/games/rooms/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ code }),
    })
      .then(async resp => {
        const data = await resp.json().catch(() => ({}));
        if (!alive) return;
        if (resp.status === 401) {
          router.replace(`/?next=${encodeURIComponent(`/join/${code}`)}`);
        } else if (!resp.ok) {
          setError(data?.error || 'That invite link didn\'t work');
        } else {
          router.replace(inviteDestination(data) || '/dashboard');
        }
      })
      .catch(() => { if (alive) setError('That invite link didn\'t work'); });
    return () => { alive = false; };
  }, [router, code]);

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center px-4">
      <Head>
        <title>Join by invite</title>
      </Head>
      <div className="w-full max-w-md rounded-lg bg-white dark:bg-gray-800 shadow-md p-6 text-gray-900 dark:text-gray-100">
        {error ? (
          <>
            <h1 className="text-xl font-semibold mb-2">Couldn&apos;t use that invite</h1>
            <p role="alert" className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>
            <Link href="/dashboard" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">Back to the dashboard</Link>
          </>
        ) : (
          <p className="text-sm text-gray-600 dark:text-gray-300">Joining…</p>
        )}
      </div>
    </div>
  );
}
