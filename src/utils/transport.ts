// Transport mode is now always 'supabase' - Socket.IO has been removed
export type TransportMode = 'supabase';

export function getTransportMode(): TransportMode {
  return 'supabase';
}

export function setTransportMode(_mode: TransportMode): void {
  // No-op: transport mode is always 'supabase'
}
