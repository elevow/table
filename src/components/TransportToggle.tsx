import { getTransportMode, type TransportMode } from '../utils/transport';

/**
 * TransportToggle component - deprecated
 * Socket.IO transport has been removed. Only Supabase transport is supported.
 * This component is kept for backward compatibility but doesn't display any UI.
 */
export function TransportToggle() {
  const mode = getTransportMode();
  
  // No toggle needed - only Supabase transport is supported
  return (
    <div className="text-sm text-gray-500">
      Transport: {mode}
    </div>
  );
}
