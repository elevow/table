import { useEffect, useState } from 'react';
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
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AdminAlertDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/admin/alerts', { headers: authHeaders() });
        if (res.status === 401 || res.status === 403) throw new Error('Sign in with an admin account to view alerts.');
        const json = await res.json();
        setAlerts(json.alerts || []);
      } catch (e: any) {
        setError(e?.message || 'Failed to load alerts');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <h1>Admin Alerts</h1>
      {loading && <p>Loading…</p>}
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {!loading && !error && alerts.length === 0 && <p>No alerts.</p>}
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
