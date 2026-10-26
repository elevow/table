import React, { useEffect, useState } from 'react';
import { authHeaders } from '../utils/auth-headers';
import { NOTE_COLORS, NOTE_COLOR_CLASSES, type NoteColor } from '../lib/shared/note-colors';
import HudBadge, { fetchHudStats, type HudMap } from './HudBadge';

// HUD numbers change slowly, so a refresh every few minutes is plenty
const HUD_REFRESH_MS = 3 * 60 * 1000;

export type NotesMap = Record<string, { note: string; color: string | null }>;

interface Props {
  // Other players at the table
  players: Array<{ id: string; name: string }>;
  notes: NotesMap;
  onNotesChange: (notes: NotesMap) => void;
}

/** Load your private notes about these players. */
export async function fetchNotes(subjectIds: string[]): Promise<NotesMap> {
  if (subjectIds.length === 0) return {};
  const resp = await fetch(`/api/notes?subjects=${encodeURIComponent(subjectIds.join(','))}`, { headers: authHeaders() });
  if (!resp.ok) return {};
  const data = await resp.json().catch(() => ({}));
  return data.notes || {};
}

/**
 * Your private notes and color tags for the other players at the table. Only you see them.
 */
export default function PlayerNotesPanel({ players, notes, onNotesChange }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [color, setColor] = useState<NoteColor | null>(null);
  const [saving, setSaving] = useState(false);
  const [hud, setHud] = useState<HudMap>({});
  const playerKey = players.map(p => p.id).sort().join(',');

  useEffect(() => {
    if (!playerKey) return;
    let cancelled = false;
    const load = () => fetchHudStats(playerKey.split(',')).then(s => { if (!cancelled) setHud(s); }).catch(() => {});
    load();
    const t = setInterval(load, HUD_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [playerKey]);

  useEffect(() => {
    if (!editing) return;
    setDraft(notes[editing]?.note || '');
    setColor((notes[editing]?.color as NoteColor) || null);
    // Only when switching players; typing must not be overwritten
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const resp = await fetch('/api/notes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ subjectId: editing, note: draft, color }),
      });
      if (resp.ok) {
        const next = { ...notes };
        if (!draft.trim() && !color) delete next[editing];
        else next[editing] = { note: draft, color };
        onNotesChange(next);
        setEditing(null);
      }
    } finally {
      setSaving(false);
    }
  };

  if (players.length === 0) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">Player notes</h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Private to you. Tags show VPIP/PFR · hands played together.</p>
      <ul className="space-y-1">
        {players.map(p => {
          const n = notes[p.id];
          const swatch = n?.color && NOTE_COLOR_CLASSES[n.color as NoteColor]?.swatch;
          return (
            <li key={p.id}>
              <button
                onClick={() => setEditing(editing === p.id ? null : p.id)}
                className="w-full flex items-center gap-2 text-left text-sm px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100"
                aria-expanded={editing === p.id}
              >
                <span className={`inline-block w-3 h-3 rounded-full border border-gray-300 dark:border-gray-600 ${swatch || 'bg-transparent'}`} aria-hidden="true" />
                <span className="font-medium">{p.name}</span>
                {n?.note && <span className="truncate text-xs text-gray-500 dark:text-gray-400">— {n.note}</span>}
                <HudBadge stats={hud[p.id]} />
              </button>
              {editing === p.id && (
                <div className="mt-1 mb-2 px-2">
                  <div className="flex gap-1.5 mb-2" role="radiogroup" aria-label="Color tag">
                    {NOTE_COLORS.map(c => (
                      <button
                        key={c}
                        role="radio"
                        aria-checked={color === c}
                        aria-label={c}
                        onClick={() => setColor(color === c ? null : c)}
                        className={`w-5 h-5 rounded-full ${NOTE_COLOR_CLASSES[c].swatch} ${color === c ? 'ring-2 ring-offset-2 ring-gray-900 dark:ring-white dark:ring-offset-gray-800' : ''}`}
                      />
                    ))}
                  </div>
                  <textarea
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    maxLength={2000}
                    rows={3}
                    placeholder="e.g. bluffs a lot on the river"
                    className="w-full text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 p-2"
                  />
                  <div className="flex gap-2 mt-1">
                    <button onClick={save} disabled={saving} className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-xs">
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={() => setEditing(null)} className="px-3 py-1 rounded bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-xs">Cancel</button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
