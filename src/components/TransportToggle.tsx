// TransportToggle is deprecated - transport mode is always Supabase
export function TransportToggle() {
  // No-op: Socket.IO has been removed, only Supabase transport is supported
  return (
    <div className="flex gap-2">
      <span className="px-3 py-1 rounded bg-blue-600 text-white">
        Supabase
      </span>
    </div>
  );
}
