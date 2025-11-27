export type TransportMode = 'supabase';

export function getTransportMode(): TransportMode {
  // Supabase is now the only supported transport
  return 'supabase';
}

export function setTransportMode(_mode: TransportMode): void {
  // No-op: Supabase is the only supported transport
}
