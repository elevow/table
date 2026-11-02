import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import TournamentSetupForm from '../../../src/components/tournament/TournamentSetupForm';
import { postTournamentAction } from '../../../src/lib/tournament/client';
import { authHeaders } from '../../../src/utils/auth-headers';
import type { TournamentConfig } from '../../../src/types/tournament';
import type { TournamentState } from '../../../src/types/tournament-management';

/** Edit a tournament's name and structure before it starts. */
export default function EditTournamentPage() {
  const router = useRouter();
  const id = typeof router.query.id === 'string' ? router.query.id : null;
  const [tournament, setTournament] = useState<TournamentState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/tournaments/get?tournamentId=${encodeURIComponent(id)}`, { headers: authHeaders() })
      .then(async r => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body?.error || `Could not load the tournament (${r.status})`);
        setTournament(body);
      })
      .catch(err => setLoadError(err?.message || 'Could not load the tournament'));
  }, [id]);

  const save = async (name: string, config: TournamentConfig) => {
    if (!id) return;
    setSubmitting(true);
    setError(null);
    try {
      await postTournamentAction('edit', { tournamentId: id, name, config });
      router.push(`/tournaments/${id}/manage`);
    } catch (err: any) {
      setError(err?.message || 'Could not save the changes');
      setSubmitting(false);
    }
  };

  if (!tournament) {
    return (
      <div className="container mx-auto p-6">
        {loadError ? <p role="alert" className="text-red-600">{loadError}</p> : <p>Loading tournament…</p>}
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <Head><title>{`Edit ${tournament.name}`}</title></Head>
      <div className="flex items-baseline justify-between mb-4">
        <h1 className="text-2xl font-semibold">Edit {tournament.name}</h1>
        <Link href={`/tournaments/${tournament.id}/manage`} className="text-blue-600 dark:text-blue-400 hover:underline">Back to director controls</Link>
      </div>
      {tournament.status !== 'setup' ? (
        <p>This tournament has started, so its structure can no longer be changed.</p>
      ) : (
        <>
          {tournament.registeredPlayers.length > 0 && (
            <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
              {tournament.registeredPlayers.length} players have registered; they&apos;ll play under the new structure.
            </p>
          )}
          <TournamentSetupForm
            initialName={tournament.name}
            initialConfig={tournament.config}
            submitLabel="Save changes"
            submittingLabel="Saving…"
            submitting={submitting}
            error={error}
            onSubmit={save}
          />
        </>
      )}
    </div>
  );
}
