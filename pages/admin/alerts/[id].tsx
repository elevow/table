import { useRouter } from 'next/router';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

interface AdminAlertDto {
  id: string;
  type: string;
  severity: string;
  message: string;
  at: number;
  involved: string[];
  source: string;
  status: 'new' | 'acknowledged' | 'resolved';
  evidence?: any[];
}

export default function AlertDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const [alert, setAlert] = useState<AdminAlertDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [token, setToken] = useState('');
  const [tokenInput, setTokenInput] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('adminToken') || '';
      setToken(saved);
      setTokenInput(saved);
    }
  }, []);

  const load = useCallback(async () => {
    if (!id || typeof id !== 'string' || !token) return;
    try {
      setLoading(true);
      const res = await fetch(`/api/admin/alerts/${id}`, { headers: { 'X-Admin-Token': token } });
      const json = await res.json();
      setAlert(json.alert || null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load alert');
    } finally {
      setLoading(false);
    }
  }, [id, token]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (status: 'new' | 'acknowledged' | 'resolved') => {
    if (!id || typeof id !== 'string') return;
    setUpdating(true);
    try {
      const res = await fetch(`/api/admin/alerts/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Admin-Token': token } : {}) }, body: JSON.stringify({ status }) });
      const json = await res.json();
      setAlert(json.alert || null);
    } catch (e: any) {
      setError(e?.message || 'Failed to update');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div style={{ padding: 24 }}>
  <Link href="/admin/alerts">← Back to Alerts</Link>
      {!token && (
        <div style={{ margin: '12px 0', padding: 12, border: '1px solid #eee', borderRadius: 8 }}>
          <p style={{ marginTop: 0 }}>Enter admin token to access alert details.</p>
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
        <div style={{ margin: '12px 0' }}>
          <button onClick={() => { setToken(''); if (typeof window !== 'undefined') window.localStorage.removeItem('adminToken'); }}>Change token</button>
        </div>
      )}
      {loading && <p>Loading…</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {!loading && !alert && <p>Not found.</p>}
      {alert && (
        <div>
          <h1>Alert {alert.id}</h1>
          <p><strong>Source:</strong> {alert.source}</p>
          <p><strong>Type:</strong> {alert.type}</p>
          <p><strong>Severity:</strong> {alert.severity}</p>
          <p><strong>Status:</strong> {alert.status}</p>
          <p><strong>Message:</strong> {alert.message}</p>
          <p><strong>At:</strong> {new Date(alert.at).toLocaleString()}</p>
          <p><strong>Involved:</strong> {alert.involved.join(', ') || '—'}</p>
          <div style={{ marginTop: 16 }}>
            <button disabled={!token || updating || alert.status === 'acknowledged'} onClick={() => setStatus('acknowledged')}>Acknowledge</button>
            <button style={{ marginLeft: 8 }} disabled={!token || updating || alert.status === 'resolved'} onClick={() => setStatus('resolved')}>Resolve</button>
          </div>
          {alert.evidence && alert.evidence.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <h3>Evidence</h3>
              {alert.evidence.map((e, idx) => (
                <details key={idx} style={{ marginBottom: 8 }}>
                  <summary>Evidence #{idx + 1}</summary>
                  <pre style={{ whiteSpace: 'pre-wrap', overflowX: 'auto', background: '#f7f7f7', padding: 12, borderRadius: 8 }}>{JSON.stringify(e, null, 2)}</pre>
                </details>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
