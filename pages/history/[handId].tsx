import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import AppShell, { PageHeader } from '../../src/components/AppShell';
import { useRouter } from 'next/router';
import { authHeaders } from '../../src/utils/auth-headers';
import { downloadHandHistory } from '../../src/utils/download-hand-history';
import MiniCard from '../../src/components/MiniCard';
import { useDisplaySettings } from '../../src/hooks/useDisplaySettings';
import { buildReplayFrames, describeAction, streetLabel } from '../../src/lib/shared/hand-replay';
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
  // Cards follow the player's display settings, including any change they made at that table
  const { highContrastCards: hc } = useDisplaySettings(hand?.roomId || null).settings;

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
    <AppShell>
      <Head><title>{hand ? `Hand #${hand.handNumber}` : 'Hand'} - Table</title></Head>
      <main className="page">
        <Link href={hand ? `/history?room=${encodeURIComponent(hand.roomId)}` : '/history'} className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M12.8 5.2a1 1 0 010 1.4L9.4 10l3.4 3.4a1 1 0 01-1.4 1.4l-4.1-4.1a1 1 0 010-1.4l4.1-4.1a1 1 0 011.4 0z" clipRule="evenodd" /></svg>
          {hand ? 'Hands at this table' : 'All hands'}
        </Link>
        <PageHeader
          title={<span className="inline-flex items-center gap-3">
            {hand ? `Hand #${hand.handNumber}` : 'Hand'}
            {hand?.kind === 'bomb-pot' && <span className="badge badge-amber">Bomb pot</span>}
          </span>}
          subtitle={hand ? <span className="tabular-nums">{new Date(hand.endedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · Blinds ${hand.smallBlind}/${hand.bigBlind} · Pot ${hand.pot}</span> : undefined}
          actions={<>
            <Link href="/history" className="btn btn-ghost">All hands</Link>
            {hand && (
              <button
                onClick={() => downloadHandHistory({ handId: hand.id }).catch(e => setError(e?.message || 'Could not export hand'))}
                className="btn btn-secondary"
                title="Download in PokerStars hand-history format"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg>
                Export .txt
              </button>
            )}
          </>}
        />
        {error && <div role="alert" className="p-3 mb-4 rounded-lg bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 text-sm">{error}</div>}
        {!hand && !error && (
          <div className="surface p-6 space-y-3 animate-pulse" aria-label="Loading">
            <div className="h-40 rounded-xl bg-gray-200 dark:bg-white/6" />
            <div className="h-4 w-1/2 rounded-sm bg-gray-200 dark:bg-white/6" />
          </div>
        )}

        {hand && frame && (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-4">
              {/* Table */}
              <div className="table-rail rounded-[28px] p-3">
                <div className="table-felt rounded-[20px] p-4 sm:p-6">
                  <div className="flex flex-col items-center gap-3 mb-6">
                    {frame.result && hand.runBoards?.length ? (
                      // Run more than once: every run's board on the result
                      hand.runBoards.map((board, r) => (
                        <div key={r} className="flex items-center gap-2">
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-white/70 w-12">Run {r + 1}</span>
                          <div className="flex gap-1">{board.map((c, i) => <MiniCard key={i} card={c} size="md" highContrast={hc} />)}</div>
                        </div>
                      ))
                    ) : (
                      <div className="flex gap-1 min-h-14">
                        {hand.board.slice(0, frame.boardCount).map((c, i) => <MiniCard key={i} card={c} size="md" highContrast={hc} />)}
                      </div>
                    )}
                    <div className="inline-flex items-center gap-1.5 bg-black/35 ring-1 ring-white/10 backdrop-blur-xs px-3 py-1 rounded-full text-sm font-semibold tabular-nums text-white">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-white/60">Pot</span>
                      {money(frame.pot)}
                    </div>
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
                          className={`rounded-xl border p-3 bg-gray-950/80 backdrop-blur-xs text-gray-100 transition-opacity ${out ? 'opacity-50' : ''} ${isWinner ? 'border-amber-300/70 shadow-[0_0_0_3px_rgba(252,211,77,0.25)]' : 'border-white/10'}`}
                        >
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-medium text-gray-200 truncate">{p.name}</span>
                            <span className="tabular-nums text-emerald-300 font-semibold">{money(frame.stacks[p.id] ?? 0)}</span>
                          </div>
                          <div className="flex gap-0.5 my-2 min-h-12">
                            {hole && hole.map((c, i) => <MiniCard key={i} card={c} highContrast={hc} />)}
                            {!hole && down && down.slice(0, 2).map((c, i) => <MiniCard key={`d${i}`} card={c} highContrast={hc} />)}
                            {!hole && !down && !up.length && [0, 1].map(i => <MiniCard key={i} />)}
                            {up.map((c, i) => <MiniCard key={`u${i}`} card={c} highContrast={hc} />)}
                            {!hole && down && down.slice(2).map((c, i) => <MiniCard key={`d${i + 2}`} card={c} highContrast={hc} />)}
                          </div>
                          <div className="text-xs text-gray-400 min-h-4">
                            {isWinner
                              ? <span className="font-semibold text-amber-300">Wins {money(frame.result!.find(w => w.playerId === p.id)!.amount)}</span>
                              : act ? describeAction(act, '', money).trim() : out ? 'Folded' : ''}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Controls */}
              <div className="surface p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button className="btn btn-secondary btn-sm px-2.5!" onClick={() => { setPlaying(false); setFrameIndex(0); }} aria-label="First step" title="First step"><svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M5 4a1 1 0 011 1v4.2l7.4-4.9A1 1 0 0115 5.1v9.8a1 1 0 01-1.6.8L6 10.8V15a1 1 0 11-2 0V5a1 1 0 011-1z" /></svg></button>
                  <button className="btn btn-secondary btn-sm px-2.5!" onClick={() => setFrameIndex(i => Math.max(0, i - 1))} aria-label="Previous step" title="Previous step"><svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M13.4 4.3A1 1 0 0115 5.1v9.8a1 1 0 01-1.6.8l-7-4.9a1 1 0 010-1.6l7-4.9z" /></svg></button>
                  <button
                    className="btn btn-primary btn-sm min-w-[84px]"
                    onClick={() => {
                      if (frameIndex >= last) setFrameIndex(0);
                      setPlaying(p => !p);
                    }}
                  >
                    {playing ? 'Pause' : frameIndex >= last ? 'Replay' : 'Play'}
                  </button>
                  <button className="btn btn-secondary btn-sm px-2.5!" onClick={() => setFrameIndex(i => Math.min(last, i + 1))} aria-label="Next step" title="Next step"><svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M6.6 4.3A1 1 0 005 5.1v9.8a1 1 0 001.6.8l7-4.9a1 1 0 000-1.6l-7-4.9z" /></svg></button>
                  <button className="btn btn-secondary btn-sm px-2.5!" onClick={() => { setPlaying(false); setFrameIndex(last); }} aria-label="Last step" title="Last step"><svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M15 4a1 1 0 00-1 1v4.2L6.6 4.3A1 1 0 005 5.1v9.8a1 1 0 001.6.8L14 10.8V15a1 1 0 102 0V5a1 1 0 00-1-1z" /></svg></button>
                  <span className="ml-2 text-sm text-gray-700 dark:text-gray-200">{frame.caption}</span>
                </div>
                <div className="mt-3 h-1 rounded-full bg-gray-200 dark:bg-white/8 overflow-hidden" aria-hidden="true">
                  <div className="h-full bg-emerald-500 transition-[width] duration-200" style={{ width: `${frames.length > 1 ? (frameIndex / last) * 100 : 100}%` }} />
                </div>
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Step {frameIndex + 1} of {frames.length}. Arrow keys step through the hand.</p>
              </div>
            </div>

            {/* Action log */}
            <div className="surface p-5 self-start">
              <h2 className="section-title mb-3">Actions</h2>
              <ol className="text-[13px] leading-5 space-y-0.5">
                {hand.actions.map((a, i) => {
                  const newStreet = i === 0 || hand.actions[i - 1].stage !== a.stage;
                  return (
                    <React.Fragment key={i}>
                      {newStreet && <li className="pt-2 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 first:pt-0">{streetLabel(a.stage, hand.variant)}</li>}
                      <li>
                        <button
                          onClick={() => { setPlaying(false); setFrameIndex(i + 1); }}
                          className={`text-left w-full px-2 py-1 rounded-md transition-colors ${frame.step === i ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-400/10 dark:text-emerald-100' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/4'}`}
                        >
                          {describeAction(a, names.get(a.playerId) || 'Player', money, pid => names.get(pid))}
                        </button>
                      </li>
                    </React.Fragment>
                  );
                })}
                <li className="pt-1">
                  <button
                    onClick={() => { setPlaying(false); setFrameIndex(last); }}
                    className={`text-left w-full px-2 py-1 rounded-md font-semibold transition-colors ${frameIndex === last ? 'bg-amber-50 text-amber-900 dark:bg-amber-400/10 dark:text-amber-200' : 'text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/4'}`}
                  >
                    {frames[last].caption}
                  </button>
                </li>
              </ol>
            </div>
          </div>
        )}
      </main>
    </AppShell>
  );
}
