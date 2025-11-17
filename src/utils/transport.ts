export type TransportMode = 'socket' | 'supabase' | 'hybrid';

export function getTransportMode(): TransportMode {
  if (typeof window === 'undefined') {
    return (process.env.NEXT_PUBLIC_REALTIME_TRANSPORT as TransportMode) || 'socket';
  }
  const stored = localStorage.getItem('realtime_transport') as TransportMode | null;
  if (stored) return stored;
  return (process.env.NEXT_PUBLIC_REALTIME_TRANSPORT as TransportMode) || 'socket';
}

export function setTransportMode(mode: TransportMode): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('realtime_transport', mode);
  }
}
