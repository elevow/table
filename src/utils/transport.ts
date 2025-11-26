export type TransportMode = 'supabase';

export function getTransportMode(): TransportMode {
  // Socket.IO transport has been removed - only Supabase transport is supported
  return 'supabase';
}

export function setTransportMode(_mode: TransportMode): void {
  // No-op: Socket.IO transport has been removed, only Supabase is supported
}
