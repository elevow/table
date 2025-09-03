import { useEffect, useState } from 'react';

interface AdminAlertDto {
  id: string;
  type: string;
  severity: string;
  message: string;
  at: number;
  involved: string[];
  source: string;
  status: 'new' | 'acknowledged' | 'resolved';
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AdminAlertDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [tokenInput, setTokenInput] = useState('');

  useEffect(() => {
    // Load saved admin token from localStorage
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('adminToken') || '';
      setToken(saved);
      setTokenInput(saved);
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        if (!token) return;
        setLoading(true);
        const res = await fetch('/api/admin/alerts', { headers: { 'X-Admin-Token': token } });
        const json = await res.json();
        setAlerts(json.alerts || []);
      } catch (e: any) {
        setError(e?.message || 'Failed to load alerts');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [token]);

  return (
    <div style={{ padding: 24 }}>
      <h1>Admin Alerts</h1>
      {!token && (
        <div style={{ marginBottom: 16, padding: 12, border: '1px solid #eee', borderRadius: 8 }}>
          <p style={{ marginTop: 0 }}>Enter admin token to access alerts.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="password"
              placeholder="Admin token"
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              style={{ flex: 1 }}
            />
            <button onClick={() => { setToken(tokenInput); if (typeof window !== 'undefined') window.localStorage.setItem('adminToken', tokenInput); }}>Save</button>
          </div>
        </div>
      )}
      {token && (
        <div style={{ marginBottom: 12 }}>
          <button onClick={() => { setToken(''); if (typeof window !== 'undefined') window.localStorage.removeItem('adminToken'); }}>Change token</button>
        </div>
      )}
      {loading && <p>Loading…</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {!loading && alerts.length === 0 && <p>No alerts.</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {alerts.map(a => (
          <li key={a.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong>[{a.source}] {a.type}</strong> <span style={{ color: a.severity === 'high' ? '#b00020' : a.severity === 'medium' ? '#c77d00' : '#666' }}>({a.severity})</span>
                <div style={{ marginTop: 4 }}>{a.message}</div>
                <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>At: {new Date(a.at).toLocaleString()} • Involved: {a.involved.join(', ') || '—'}</div>
              </div>
              <a href={`/admin/alerts/${a.id}`} style={{ textDecoration: 'underline' }}>View</a>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
