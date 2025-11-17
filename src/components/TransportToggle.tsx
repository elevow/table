import { useState } from 'react';
import { getTransportMode, setTransportMode, type TransportMode } from '../utils/transport';

export function TransportToggle() {
  const [mode, setMode] = useState<TransportMode>(getTransportMode);

  const handleChange = (newMode: TransportMode) => {
    setTransportMode(newMode);
    setMode(newMode);
    window.location.reload();
  };

  return (
    <div className="flex gap-2">
      <button
        onClick={() => handleChange('socket')}
        className={`px-3 py-1 rounded ${mode === 'socket' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
      >
        Socket
      </button>
      <button
        onClick={() => handleChange('supabase')}
        className={`px-3 py-1 rounded ${mode === 'supabase' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
      >
        Supabase
      </button>
      <button
        onClick={() => handleChange('hybrid')}
        className={`px-3 py-1 rounded ${mode === 'hybrid' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
      >
        Hybrid
      </button>
    </div>
  );
}
