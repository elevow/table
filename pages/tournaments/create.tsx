import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import TournamentSetupForm from '../../src/components/tournament/TournamentSetupForm';
import { loadPermissions, postTournamentAction } from '../../src/lib/tournament/client';
import { authHeaders } from '../../src/utils/auth-headers';
import type { TournamentConfig } from '../../src/types/tournament';
import type { TournamentState } from '../../src/types/tournament-management';

const linkButton = 'text-sm text-blue-600 dark:text-blue-400 hover:underline';

export default function CreateTournamentPage() {
  const router = useRouter();
  // Assumed until permissions load; the API refuses without tournament.create anyway
  const [canCreate, setCanCreate] = useState(true);
  const [signedIn, setSignedIn] = useState(true);
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<TournamentState | null>(null);
  // Bumped to give "Create another" a fresh form
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (!authHeaders().Authorization) {
      setSignedIn(false);
      return;
    }
    loadPermissions().then(p => { if (p) setCanCreate(p.includes('tournament.create')); });
  }, []);

  const create = async (name: string, config: TournamentConfig) => {
    setSubmitting(true);
    setError(null);
    try {
      setCreated(await postTournamentAction('create', { name, config, visibility }));
    } catch (err: any) {
      setError(err?.message || 'Could not create the tournament');
    } finally {
      setSubmitting(false);
    }
  };

  if (created) {
    return (
      <div className="container mx-auto p-6 max-w-3xl">
        <Head><title>Tournament Created</title></Head>
        <h1 className="text-2xl font-semibold mb-4">Tournament created</h1>
        <div role="status" className="rounded-sm bg-green-50 dark:bg-green-900/30 border border-green-300 dark:border-green-700 p-4 space-y-1 text-sm">
          <p className="font-medium">{created.name}</p>
          <p>
            {created.config.blindLevels.length} levels, {created.config.startingStack.toLocaleString()} starting stack,{' '}
            {created.config.seatsPerTable ?? 9}-max tables. Registration is open.
          </p>
          {created.visibility === 'private' && (
            <p>It&apos;s private: get the invite link from the director controls and send it to your players.</p>
          )}
          <p className="text-gray-600 dark:text-gray-400">Tournament ID: <code>{created.id}</code></p>
        </div>
        <div className="mt-4 flex gap-4">
          <button className="px-4 py-2 bg-blue-600 text-white rounded-sm" onClick={() => router.push(`/tournaments/${created.id}`)}>
            View tournament
          </button>
          {created.visibility === 'private' && (
            <button className={linkButton} onClick={() => router.push(`/tournaments/${created.id}/manage`)}>Director controls</button>
          )}
          <button className={linkButton} onClick={() => { setCreated(null); setVisibility('public'); setFormKey(k => k + 1); }}>Create another</button>
          <button className={linkButton} onClick={() => router.push('/dashboard')}>Back to dashboard</button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <Head><title>Create Tournament</title></Head>
      <h1 className="text-2xl font-semibold mb-4">Create Tournament</h1>
      {!signedIn && <p className="mb-4 text-sm text-red-600">Sign in to create a tournament.</p>}
      {signedIn && !canCreate && (
        <p className="mb-4 text-sm text-red-600">You don&apos;t have permission to create tournaments. Ask an admin for the Tournament Director role.</p>
      )}
      <fieldset className="mb-6">
        <legend className="text-lg font-semibold mb-2">Who can join</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="tournament-visibility" checked={visibility === 'public'} onChange={() => setVisibility('public')} />
            Public: listed in the tournament lobby
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="radio" name="tournament-visibility" checked={visibility === 'private'} onChange={() => setVisibility('private')} />
            Private: only people with the invite link
          </label>
        </div>
      </fieldset>
      <TournamentSetupForm
        key={formKey}
        submitLabel="Create tournament"
        submittingLabel="Creating…"
        submitting={submitting}
        error={error}
        blocked={!signedIn || !canCreate}
        onSubmit={create}
      />
    </div>
  );
}
