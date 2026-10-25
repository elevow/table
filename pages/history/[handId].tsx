import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { authHeaders } from '../../src/utils/auth-headers';
import MiniCard from '../../src/components/MiniCard';
import { buildReplayFrames, describeAction } from '../../src/lib/shared/hand-replay';
import type { HandRecord } from '../../src/types/hand-record';

const money = (n: number) => `$${n}`;
const STEP_MS = 1100;

export default function HandReplayPage() {
  const router = useRouter();
  const handId = typeof router.query.handId === 'string' ? router.query.handId : '';
  const [hand, setHand] = useState<HandRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!handId) return;
    fetch(`/api/history/hands/${handId}`, { headers: authHeaders() })
      .then(async resp => {
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(resp.status === 401 ? 'Sign in to see this hand.' : data?.error || 'Could not load hand');
        setHand(data.hand);
        setFrameIndex(0);
      })
      .catch(e => setError(e?.message || 'Could not load hand'));
  }, [handId]);

  const frames = useMemo(() => (hand ? buildReplayFrames(hand, money) : []), [hand]);
  const frame = frames[frameIndex];
  const last = frames.length - 1;

  // Autoplay one step at a time
  useEffect(() => {
    if (!playing) return;
    if (frameIndex >= last) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setFrameIndex(i => Math.min(last, i + 1)), STEP_MS);
    return () => clearTimeout(t);
  }, [playing, frameIndex, last]);

  // Arrow keys step through the hand
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setFrameIndex(i => Math.min(last, i + 1));
      if (e.key === 'ArrowLeft') setFrameIndex(i => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [last]);

  const names = useMemo(() => new Map((hand?.players || []).map(p => [p.id, p.name])), [hand]);

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900">
      <Head><title>{hand ? `Hand #${hand.handNumber}` : 'Hand'} - Table</title></Head>
      <main className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {hand ? `Hand #${hand.handNumber}` : 'Hand'}
            {hand?.kind === 'bomb-pot' && <span className="ml-2 text-sm px-2 py-0.5 rounded bg-orange-600 text-white align-middle">Bomb pot</span>}
          </h1>
          <div className="flex gap-3 text-sm">
            {hand && <Link href={`/history?room=${encodeURIComponent(hand.roomId)}`} className="text-blue-600 dark:text-blue-400 hover:underline">Hands at this table</Link>}
            <Link href="/history" className="text-blue-600 dark:text-blue-400 hover:underline">All hands</Link>
          </div>
        </div>
        {error && <div className="p-3 rounded bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-200 text-sm">{error}</div>}
        {!hand && !error && <p className="text-gray-500 dark:text-gray-400">Loading…</p>}

        {hand && frame && (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              {new Date(hand.endedAt).toLocaleString()} · Blinds ${hand.smallBlind}/${hand.bigBlind} · Pot ${hand.pot}
            </p>

            {/* Table */}
            <div className="rounded-2xl p-4 sm:p-6 mb-4 shadow-inner" style={{ background: 'radial-gradient(ellipse at center, #16a34a 0%, #15803d 60%, #14532d 100%)' }}>
              <div className="flex flex-col items-center gap-2 mb-5">
                {frame.result && hand.runBoards?.length ? (
                  // Run more than once: every run's board on the result
                  hand.runBoards.map((board, r) => (
                    <div key={r} className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-amber-100 w-12">Run {r + 1}</span>
                      <div className="flex gap-1">{board.map((c, i) => <MiniCard key={i} card={c} size="md" />)}</div>
                    </div>
                  ))
                ) : (
                  <div className="flex gap-1 min-h-[3.5rem]">
                    {hand.board.slice(0, frame.boardCount).map((c, i) => <MiniCard key={i} card={c} size="md" />)}
                  </div>
                )}
                <div className="px-3 py-1 rounded bg-gray-900/70 text-white text-sm font-semibold">Pot {money(frame.pot)}</div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {hand.players.map(p => {
                  const isWinner = !!frame.result?.some(w => w.playerId === p.id);
                  const out = frame.folded.has(p.id);
                  const act = frame.lastAction[p.id];
                  const cards = p.cards;
                  const hole = cards?.hole;
                  const up = (cards?.up || []).slice(0, frame.upCount);
                  const down = cards?.down;
                  return (
                    <div
                      key={p.id}
                      className={`rounded-lg p-3 bg-white/95 dark:bg-gray-800/95 shadow ${out ? 'opacity-50' : ''} ${isWinner ? 'ring-4 ring-yellow-400' : ''}`}
                    >
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-semibold text-gray-900 dark:text-gray-100">{p.name}</span>
                        <span className="tabular-nums text-emerald-700 dark:text-emerald-400 font-semibold">{money(frame.stacks[p.id] ?? 0)}</span>
                      </div>
                      <div className="flex gap-0.5 my-2 min-h-[3rem]">
                        {hole && hole.map((c, i) => <MiniCard key={i} card={c} />)}
                        {!hole && down && down.map((c, i) => <MiniCard key={`d${i}`} card={c} />)}
                        {!hole && !down && !up.length && [0, 1].map(i => <MiniCard key={i} />)}
                        {up.map((c, i) => <MiniCard key={`u${i}`} card={c} />)}
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-300 min-h-[1rem]">
                        {isWinner
                          ? <span className="font-semibold text-yellow-700 dark:text-yellow-300">Wins {money(frame.result!.find(w => w.playerId === p.id)!.amount)}</span>
                          : act ? describeAction(act, '', money).trim() : out ? 'Folded' : ''}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <button className="px-3 py-1.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100" onClick={() => { setPlaying(false); setFrameIndex(0); }} aria-label="First step">⏮</button>
              <button className="px-3 py-1.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100" onClick={() => setFrameIndex(i => Math.max(0, i - 1))} aria-label="Previous step">◀</button>
              <button
                className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white font-medium"
                onClick={() => {
                  if (frameIndex >= last) setFrameIndex(0);
                  setPlaying(p => !p);
                }}
              >
                {playing ? 'Pause' : frameIndex >= last ? 'Replay' : 'Play'}
              </button>
              <button className="px-3 py-1.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100" onClick={() => setFrameIndex(i => Math.min(last, i + 1))} aria-label="Next step">▶</button>
              <button className="px-3 py-1.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100" onClick={() => { setPlaying(false); setFrameIndex(last); }} aria-label="Last step">⏭</button>
              <span className="text-sm text-gray-700 dark:text-gray-200 ml-2">{frame.caption}</span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">Step {frameIndex + 1} of {frames.length}. Arrow keys step through the hand.</p>

            {/* Action log */}
            <div className="rounded-lg bg-white dark:bg-gray-800 shadow p-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">Actions</h2>
              <ol className="text-sm space-y-0.5">
                {hand.actions.map((a, i) => {
                  const newStreet = i === 0 || hand.actions[i - 1].stage !== a.stage;
                  return (
                    <React.Fragment key={i}>
                      {newStreet && <li className="pt-1 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{a.stage}</li>}
                      <li>
                        <button
                          onClick={() => { setPlaying(false); setFrameIndex(i + 1); }}
                          className={`text-left w-full px-2 py-0.5 rounded ${frame.step === i ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-900 dark:text-blue-100' : 'text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                        >
                          {describeAction(a, names.get(a.playerId) || 'Player', money)}
                        </button>
                      </li>
                    </React.Fragment>
                  );
                })}
                <li>
                  <button
                    onClick={() => { setPlaying(false); setFrameIndex(last); }}
                    className={`text-left w-full px-2 py-0.5 rounded font-semibold ${frameIndex === last ? 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-900 dark:text-yellow-100' : 'text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                  >
                    {frames[last].caption}
                  </button>
                </li>
              </ol>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
