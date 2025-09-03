import { useCallback, useEffect, useMemo, useState } from 'react';

type Json = any;

export default function AdminSecurityPage() {
  const [token, setToken] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [config, setConfig] = useState<Json | null>(null);
  const [overrides, setOverrides] = useState<Json | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [lastRun, setLastRun] = useState<number | null>(null);
  const authHeaders = useMemo(() => (token ? { 'X-Admin-Token': token } : {} as Record<string, string>), [token]);
  const withAuth = useCallback((extra?: Record<string, string>) => ({ ...(extra || {}), ...authHeaders }), [authHeaders]);

  // load token
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('adminToken') || '';
      setToken(saved);
      setTokenInput(saved);
    }
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(null); setMessage(null);
    try {
  const res = await fetch('/api/admin/security/config', { headers: authHeaders });
      if (!res.ok) throw new Error(`Failed to load config: ${res.status}`);
      const json = await res.json();
      setConfig(json.config);
      setOverrides(json.overrides);
      setEditText(JSON.stringify(json.overrides || {}, null, 2));
  const sres = await fetch('/api/admin/security/scheduler', { headers: authHeaders });
      if (sres.ok) {
        const sjson = await sres.json();
        setLastRun(typeof sjson.lastRun === 'number' ? sjson.lastRun : null);
      }
    } catch (e: any) {
      setError(e?.message || 'Unable to load');
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token]);

  useEffect(() => { load(); }, [load]);

  const saveOverrides = async () => {
    setError(null); setMessage(null);
    try {
      const body = editText.trim() ? JSON.parse(editText) : {};
  const res = await fetch('/api/admin/security/config', { method: 'PATCH', headers: withAuth({ 'Content-Type': 'application/json' }), body: JSON.stringify({ overrides: body }) });
      if (!res.ok) throw new Error(`Failed to save: ${res.status}`);
      const json = await res.json();
      setConfig(json.config);
      setOverrides(json.overrides);
      setMessage('Overrides saved.');
    } catch (e: any) {
      setError(e?.message || 'Invalid JSON');
    }
  };

  const clearOverrides = async () => {
    setError(null); setMessage(null);
    try {
  const res = await fetch('/api/admin/security/config', { method: 'PATCH', headers: withAuth({ 'Content-Type': 'application/json' }), body: JSON.stringify({ clear: true }) });
      if (!res.ok) throw new Error(`Failed to clear: ${res.status}`);
      const json = await res.json();
      setConfig(json.config);
      setOverrides(json.overrides);
      setEditText(JSON.stringify(json.overrides || {}, null, 2));
      setMessage('Overrides cleared.');
    } catch (e: any) { setError(e?.message || 'Unable to clear'); }
  };

  const doScheduler = async (action: 'start' | 'stop' | 'runOnce') => {
    setError(null); setMessage(null);
    try {
  const res = await fetch('/api/admin/security/scheduler', { method: 'POST', headers: withAuth({ 'Content-Type': 'application/json' }), body: JSON.stringify({ action }) });
      if (!res.ok) throw new Error(`Failed to ${action}: ${res.status}`);
      const json = await res.json();
      if (json.lastRun) setLastRun(json.lastRun);
      setMessage(`Scheduler ${action} executed.`);
    } catch (e: any) { setError(e?.message || 'Scheduler action failed'); }
  };

  return (
    <div style={{ padding: 24, display: 'grid', gap: 16 }}>
      <h1>Admin Security Controls</h1>
      {!token && (
        <div style={{ padding: 12, border: '1px solid #eee', borderRadius: 8 }}>
          <p style={{ marginTop: 0 }}>Enter admin token to access security controls.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="password" placeholder="Admin token" value={tokenInput} onChange={e => setTokenInput(e.target.value)} style={{ flex: 1 }} />
            <button onClick={() => { setToken(tokenInput); if (typeof window !== 'undefined') window.localStorage.setItem('adminToken', tokenInput); }}>Save</button>
          </div>
        </div>
      )}
      {token && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { setToken(''); if (typeof window !== 'undefined') window.localStorage.removeItem('adminToken'); }}>Change token</button>
          <button onClick={load} disabled={loading}>Refresh</button>
        </div>
      )}

      {error && <div style={{ color: '#b00020' }}>{error}</div>}
      {message && <div style={{ color: '#0a7f2e' }}>{message}</div>}

      <section style={{ border: '1px solid #eee', borderRadius: 8, padding: 12 }}>
        <h2 style={{ marginTop: 0 }}>Live Security Config</h2>
        {loading && <p>Loading…</p>}
        {!loading && config && (
          <div style={{ display: 'grid', gap: 12 }}>
            <details open>
              <summary>Effective config</summary>
              <pre style={{ whiteSpace: 'pre-wrap', overflowX: 'auto', background: '#f7f7f7', padding: 12, borderRadius: 8 }}>{JSON.stringify(config, null, 2)}</pre>
            </details>
            <details>
              <summary>Current overrides</summary>
              <pre style={{ whiteSpace: 'pre-wrap', overflowX: 'auto', background: '#f7f7f7', padding: 12, borderRadius: 8 }}>{JSON.stringify(overrides || {}, null, 2)}</pre>
            </details>
            <div>
              <label style={{ display: 'block', marginBottom: 8 }}>Edit overrides (JSON)</label>
              <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={16} style={{ width: '100%', fontFamily: 'monospace' }} />
              <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                <button disabled={!token} onClick={saveOverrides}>Save overrides</button>
                <button disabled={!token} onClick={clearOverrides}>Clear overrides</button>
              </div>
            </div>
          </div>
        )}
      </section>

      <section style={{ border: '1px solid #eee', borderRadius: 8, padding: 12 }}>
        <h2 style={{ marginTop: 0 }}>Scheduler</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button disabled={!token} onClick={() => doScheduler('start')}>Start</button>
          <button disabled={!token} onClick={() => doScheduler('stop')}>Stop</button>
          <button disabled={!token} onClick={() => doScheduler('runOnce')}>Run once</button>
          <span style={{ marginLeft: 12, color: '#555' }}>Last Run: {lastRun ? new Date(lastRun).toLocaleString() : '—'}</span>
        </div>
      </section>
    </div>
  );
}
