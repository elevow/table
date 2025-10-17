import { useState, useEffect } from 'react';
import { isAdminEmail } from '../utils/roleUtils';

interface Room {
  id: string;
  room_id?: string;
  room_code?: string;
  game_type?: string;
  game_variant?: string;
  configuration?: any;
  max_players: number;
  players_count?: number;
  current_players?: number;
  status: string;
  created_at: string;
  creator_username?: string;
  creator_email?: string;
}

interface AdminRoomsResponse {
  success: boolean;
  rooms: Room[];
  total: number;
  page: number;
  limit: number;
}

export default function AdminRoomsPanel() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  // Check if current user is admin
  useEffect(() => {
    async function checkAdminStatus() {
      try {
        const sessionToken = localStorage.getItem('auth_token') || localStorage.getItem('session_token');
        console.log('AdminRoomsPanel: Checking admin status, session token:', sessionToken ? 'Present' : 'Missing');
        
        if (!sessionToken || sessionToken === 'null') {
          console.log('AdminRoomsPanel: No valid session token found');
          setIsAdmin(false);
          setLoading(false);
          return;
        }

        // Check if user is admin by trying to fetch admin data
        const response = await fetch('/api/admin/rooms?page=1&limit=1', {
          headers: {
            'Authorization': `Bearer ${sessionToken}`,
          },
        });

        // console.log('AdminRoomsPanel: Admin check response status:', response.status);
        
        if (response.ok) {
          // console.log('AdminRoomsPanel: User is admin!');
          setIsAdmin(true);
        } else {
          const errorText = await response.text();
          console.log('AdminRoomsPanel: Admin check failed:', errorText);
          setIsAdmin(false);
        }
        
        setLoading(false);
      } catch (error) {
        console.error('AdminRoomsPanel: Error checking admin status:', error);
        setIsAdmin(false);
        setLoading(false);
      }
    }

    checkAdminStatus();
  }, []);

  // Fetch rooms data
  useEffect(() => {
    async function fetchRooms() {
      if (!isAdmin) return;

      try {
        const sessionToken = localStorage.getItem('auth_token') || localStorage.getItem('session_token');
        const response = await fetch('/api/admin/rooms?page=1&limit=20', {
          headers: {
            'Authorization': `Bearer ${sessionToken}`,
          },
        });

        if (response.ok) {
          const data: AdminRoomsResponse = await response.json();
          setRooms(data.rooms);
          setTotal(data.total);
        } else {
          setError('Failed to fetch rooms');
        }
      } catch (err) {
        console.error('Error fetching rooms:', err);
        setError('Network error');
      }
    }

    fetchRooms();
  }, [isAdmin]);

  // Delete room function
  const deleteRoom = async (roomId: string) => {
    try {
      setDeleting(roomId);
      setMessage('');
      setError('');

      const sessionToken = localStorage.getItem('auth_token') || localStorage.getItem('session_token');
      const response = await fetch(`/api/admin/rooms/${roomId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        // Remove the room from the local state
        setRooms(prev => prev.filter(room => room.id !== roomId));
        setTotal(prev => prev - 1);
        setMessage('Room deleted successfully');
        setDeleteConfirm(null);
      } else {
        const errorData = await response.json();
        setError(`Failed to delete room: ${errorData.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Error deleting room:', err);
      setError('Network error occurred while deleting room');
    } finally {
      setDeleting(null);
    }
  };

  // Clear messages after 5 seconds
  useEffect(() => {
    if (message || error) {
      const timer = setTimeout(() => {
        setMessage('');
        setError('');
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [message, error]);

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mt-8">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="space-y-3">
            <div className="h-4 bg-gray-200 rounded"></div>
            <div className="h-4 bg-gray-200 rounded w-5/6"></div>
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return null; // Don't show anything for non-admin users
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  // Status color helper removed as column is no longer displayed

  // Map internal variant keys to friendly names
  const variantLabelMap: Record<string, string> = {
    'texas-holdem': "Texas Hold'em",
    'holdem': "Texas Hold'em",
    'no-limit-holdem': "No-Limit Hold'em",
    'pot-limit-holdem': "Pot-Limit Hold'em",
    'fixed-limit-holdem': "Fixed-Limit Hold'em",
    'omaha': 'Omaha',
    'omaha-hi-lo': 'Omaha Hi/Lo',
    'omaha-hilo': 'Omaha Hi/Lo',
    'seven-card-stud': 'Seven Card Stud',
    'seven-card-stud-hi-lo': 'Seven Card Stud Hi/Lo',
    'five-card-stud': 'Five Card Stud',
    'poker': 'Poker',
  };

  const bettingLabelMap: Record<string, string> = {
    'no-limit': 'No-Limit',
    'pot-limit': 'Pot-Limit',
    'fixed-limit': 'Fixed-Limit',
    'limit': 'Limit',
  };

  const getFriendlyVariant = (room: Room): string => {
    // Prefer explicit variant from configuration
    let config: any = (room as any).configuration;
    if (typeof config === 'string') {
      try { config = JSON.parse(config); } catch { /* ignore parse errors */ }
    }

    let variant: string | undefined = (room as any).game_variant || (config?.variant as string | undefined) || (room as any).game_type;
    if (variant) variant = String(variant).toLowerCase();

    // Some schemas might store variant under configuration.game?.variant
    if (!variant && config?.game?.variant) {
      variant = String(config.game.variant).toLowerCase();
    }

    // If variant is missing or generic 'poker', default to Texas Hold'em
    let baseLabel = variantLabelMap[variant || ''] || (variant === 'poker' ? "Texas Hold'em" : undefined);
    if (!baseLabel) {
      // Fallback: prettify hyphenated variant
      baseLabel = variant ? variant.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Poker';
    }

    // Append betting mode if present
    const bettingMode: string | undefined = (config?.bettingMode || config?.betting_mode) as string | undefined;
    const bettingLabel = bettingMode ? bettingLabelMap[String(bettingMode).toLowerCase()] : undefined;

    return bettingLabel ? `${baseLabel} (${bettingLabel})` : baseLabel;
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mt-8">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center">
          <span className="bg-red-500 text-white px-2 py-1 rounded text-sm mr-3">ADMIN</span>
          All Game Rooms ({total})
        </h2>
      </div>

      {/* Success/Error Messages */}
      {message && (
        <div className="mb-4 p-4 bg-green-100 border border-green-400 text-green-700 rounded">
          {message}
        </div>
      )}
      
      {error && (
        <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {rooms.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-600 dark:text-gray-400">No rooms found</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Room Code
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Game Variant
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Players
                </th>
                {/* Status and Creator columns removed */}
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Created
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {rooms.map((room) => (
                <tr key={room.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {room.room_code || room.room_id || room.id}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900 dark:text-gray-100">
                      {getFriendlyVariant(room)}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-900 dark:text-gray-100">
                      {(room.current_players || room.players_count || 0)} / {room.max_players}
                    </div>
                  </td>
                  {/* Status and Creator cells removed */}
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {formatDate(room.created_at)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    {deleteConfirm === room.id ? (
                      <div className="flex space-x-2">
                        <button
                          onClick={() => deleteRoom(room.id)}
                          disabled={deleting === room.id}
                          className="bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white px-3 py-1 rounded text-xs font-medium"
                        >
                          {deleting === room.id ? 'Deleting...' : 'Confirm'}
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          disabled={deleting === room.id}
                          className="bg-gray-500 hover:bg-gray-600 disabled:bg-gray-400 text-white px-3 py-1 rounded text-xs font-medium"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(room.id)}
                        className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-xs font-medium"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
