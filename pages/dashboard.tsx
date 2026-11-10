import type { NextPage } from 'next';
import Head from 'next/head';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useComponentPerformance } from '../src/utils/performance-monitor';
import AppShell, { useStoredUsername } from '../src/components/AppShell';
import AdminRoomsPanel from '../src/components/AdminRoomsPanel';
import CombinedPlayerStats from '../src/components/CombinedPlayerStats';
import { authHeaders } from '../src/utils/auth-headers';
import { inviteDestination } from '../src/utils/invite-destination';
import LobbyTables from '../src/components/LobbyTables';

const Dashboard: NextPage = () => {
  const router = useRouter();
  const { markInteraction } = useComponentPerformance('DashboardPage');
  
  // Room code join functionality
  const [roomCode, setRoomCode] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validationMessage, setValidationMessage] = useState('');
  
  // User authentication state
  // Default to 'me' so the API can resolve the authenticated user server-side.
  const [userId, setUserId] = useState<string>('me');
  const username = useStoredUsername();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [canViewRoles, setCanViewRoles] = useState(false);
  // Shown until permissions load (or if they can't), since the API refuses room.create anyway
  const [canCreateRoom, setCanCreateRoom] = useState(true);
  const [restriction, setRestriction] = useState<{ kind: 'ban' | 'suspend'; until: string | null; reason: string | null } | null>(null);

  // Show the roles link to staff who can see roles or users, hide Create Room without room.create, and show any
  // suspension; the API checks again on every request
  useEffect(() => {
    const headers = authHeaders();
    if (!headers.Authorization) return;
    fetch('/api/auth/check-admin', { headers })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        const permissions: string[] = data?.permissions || [];
        setCanViewRoles(permissions.includes('roles.view') || permissions.includes('admin.users.view'));
        if (data) setCanCreateRoom(permissions.includes('room.create'));
        setRestriction(data?.sanction ?? null);
      })
      .catch(() => {});
  }, []);

  // Get authenticated user ID on component mount
  useEffect(() => {
    const getAuthenticatedUserId = async () => {
      try {
        const authToken = localStorage.getItem('auth_token');
        setIsAuthenticated(!!authToken);
        if (authToken) {
          const response = await fetch('/api/auth/me', {
            headers: {
              'Authorization': `Bearer ${authToken}`
            }
          });
          
          if (response.ok) {
            const data = await response.json();
            console.log('Dashboard - Using authenticated user ID:', data.userId);
            setUserId(data.userId);
          } else {
            console.log('Dashboard - Authentication failed, using server-resolved \"me\"');
          }
        } else {
          console.log('Dashboard - No auth token, using server-resolved \"me\"');
        }
      } catch (error) {
        console.error('Dashboard - Error getting authenticated user ID:', error);
      }
    };
    
    getAuthenticatedUserId();
  }, []);
  
  // Room code join functionality
  const handleJoinByRoomCode = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!roomCode.trim()) {
      setValidationMessage('Please enter a room code');
      return;
    }
    
    setIsValidating(true);
    setValidationMessage('');

    try {
      // A private table's invite code (10 characters, dash optional) joins the table; room codes are 8
      if (roomCode.replace(/[^A-Za-z0-9]/g, '').length === 10) {
        if (!authHeaders().Authorization) {
          setValidationMessage('Sign in to join a private table');
          return;
        }
        const joinResp = await fetch('/api/games/rooms/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ code: roomCode.trim() }),
        });
        const joined = await joinResp.json().catch(() => ({}));
        if (joinResp.ok) {
          router.push(inviteDestination(joined) || '/dashboard');
        } else {
          setValidationMessage(joined.error || 'Invite code not found');
        }
        return;
      }

      console.log('Attempting to validate room code:', roomCode.trim());
      const response = await fetch('/api/games/validate-room', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ roomCode: roomCode.trim() }),
      });
      
      const data = await response.json();
      console.log('API Response status:', response.status, 'Data:', data);
      
      if (response.ok) {
        if (data.joinable) {
          // Room exists and is joinable - navigate to the game
          console.log('Attempting to navigate to:', `/game/${data.room.id}`);
          
          try {
            // Use window.location as backup if router fails
            const navigationPromise = router.push(`/game/${data.room.id}`);
            
            // Set a timeout to check if navigation completed
            const timeoutId = setTimeout(() => {
              console.log('Navigation timeout - trying window.location.href');
              window.location.href = `/game/${data.room.id}`;
            }, 2000);
            
            // Handle the navigation promise
            navigationPromise.then(() => {
              console.log('Navigation completed successfully');
              clearTimeout(timeoutId);
            }).catch((error) => {
              console.error('Navigation error:', error);
              clearTimeout(timeoutId);
              // Fallback to window.location
              console.log('Router failed, using window.location.href');
              window.location.href = `/game/${data.room.id}`;
            });
          } catch (error) {
            console.error('Router push failed:', error);
            // Direct navigation fallback
            window.location.href = `/game/${data.room.id}`;
          }
        } else {
          // Room exists but not joinable
          console.log('Room not joinable. Reason:', data.reason);
          setValidationMessage(`Cannot join room: ${data.reason}`);
        }
      } else {
        // Room not found or other error
        console.log('API request failed. Status:', response.status, 'Data:', data);
        setValidationMessage(data.message || data.error || 'Room not found');
      }
    } catch (error) {
      console.error('Error validating room:', error);
      setValidationMessage('Failed to validate room code. Please try again.');
    } finally {
      setIsValidating(false);
    }
  };
  
  useEffect(() => {
    // Mark this interaction for performance tracking
    const endMark = markInteraction('initial-load', { 
      route: 'dashboard',
      timestamp: Date.now()
    });
    
    // End the performance mark after everything is loaded
    return () => {
      if (typeof endMark === 'function') endMark();
    };
  }, [markInteraction]);
  
  return (
    <AppShell>
      <Head>
        <title>Lobby - Table</title>
        <meta name="description" content="Table lobby - Online poker platform" />
      </Head>

      <main className="page space-y-6">
        {restriction && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
            Your account is {restriction.kind === 'ban' ? 'banned' : 'suspended'}
            {restriction.until ? ` until ${new Date(restriction.until).toLocaleString()}` : ''}.
            {restriction.reason ? ` Reason: ${restriction.reason}.` : ''} You can watch tables but not play or chat.
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-5">
          {/* Welcome and the main actions */}
          <section className="surface relative overflow-hidden p-6 lg:col-span-3">
            <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl" />
            <p className="eyebrow">Lobby</p>
            <h1 className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-gray-900 dark:text-white">
              {username ? `Welcome back, ${username}` : 'Find a seat'}
            </h1>
            <p className="mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">
              Start a table for your friends, join one that&apos;s already running, or sign up for a tournament.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {canCreateRoom && (
                <button
                  className="btn btn-primary"
                  onClick={() => { if (isAuthenticated) router.push('/game/create'); }}
                  disabled={!isAuthenticated}
                  title={isAuthenticated ? undefined : 'Sign in to create a room'}
                  data-route="/game/create"
                >
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M10 4a1 1 0 011 1v4h4a1 1 0 110 2h-4v4a1 1 0 11-2 0v-4H5a1 1 0 110-2h4V5a1 1 0 011-1z" /></svg>
                  Create a table
                </button>
              )}
              <button className="btn btn-secondary" onClick={() => router.push('/tournaments')}>
                Tournaments
              </button>
              {canViewRoles && (
                <button className="btn btn-ghost" onClick={() => router.push('/admin/roles')}>
                  Roles &amp; permissions
                </button>
              )}
            </div>
          </section>

          {/* Join by code */}
          <section className="surface p-6 lg:col-span-2">
            <h2 className="section-title">Have a code?</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Enter a room code or a private invite code.</p>
            <form onSubmit={handleJoinByRoomCode} className="mt-4 space-y-3">
              <label htmlFor="room-code" className="sr-only">Room code</label>
              <div className="flex gap-2">
                <input
                  id="room-code"
                  type="text"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  placeholder="e.g. AB12CD34"
                  className="input font-mono tracking-wider uppercase placeholder:font-sans placeholder:normal-case placeholder:tracking-normal"
                  disabled={isValidating}
                  maxLength={12}
                />
                <button
                  type="submit"
                  disabled={isValidating}
                  className="btn btn-secondary shrink-0"
                >
                  {isValidating ? 'Checking…' : 'Join'}
                </button>
              </div>
              {validationMessage && (
                <div className={`text-sm rounded-lg px-3 py-2 ${
                  validationMessage.includes('Cannot join') || validationMessage.includes('not found') || validationMessage.includes('Failed')
                    ? 'text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-500/10'
                    : 'text-gray-700 bg-gray-100 dark:text-gray-300 dark:bg-white/5'
                }`}>
                  {validationMessage}
                </div>
              )}
            </form>
          </section>
        </div>

        <LobbyTables />

        <CombinedPlayerStats />

        {/* Admin Panel - Only visible to admin users */}
        <AdminRoomsPanel />
      </main>
    </AppShell>
  );
};

export default Dashboard;
