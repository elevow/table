import { useRouter } from 'next/router';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { authHeaders } from '../../../src/utils/auth-headers';

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

  const load = useCallback(async () => {
    if (!id || typeof id !== 'string') return;
    try {
      setLoading(true);
      const res = await fetch(`/api/admin/alerts/${id}`, { headers: authHeaders() });
      if (res.status === 401 || res.status === 403) throw new Error('Sign in with an admin account to view this alert.');
      const json = await res.json();
      setAlert(json.alert || null);
    } catch (e: any) {
      setError(e?.message || 'Failed to load alert');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (status: 'new' | 'acknowledged' | 'resolved') => {
    if (!id || typeof id !== 'string') return;
    setUpdating(true);
    try {
      const res = await fetch(`/api/admin/alerts/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ status }) });
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
      {loading && <p>Loading…</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {!loading && !error && !alert && <p>Not found.</p>}
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
            <button disabled={updating || alert.status === 'acknowledged'} onClick={() => setStatus('acknowledged')}>Acknowledge</button>
            <button style={{ marginLeft: 8 }} disabled={updating || alert.status === 'resolved'} onClick={() => setStatus('resolved')}>Resolve</button>
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
