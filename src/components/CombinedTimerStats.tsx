import { useEffect, useMemo, useState, memo, useRef, useCallback } from 'react';
import { getTransportMode } from '../utils/transport';
import { useSupabaseRealtime } from '../hooks/useSupabaseRealtime';

// Timer types
type TimerState = {
  activePlayer: string;
  startTime: number;
  duration: number;
  timeBank: number;
  warning: boolean;
} | undefined;

// Session stats types
interface SessionStats {
  handsPlayed: number;
  handsWon: number;
  totalWinnings: number;
  totalLosses: number;
  biggestPotWon: number;
  foldRate: number;
  sessionStartTime: Date;
  timeInSession: string;
}

interface CombinedHUDProps {
  tableId: string;
  playerId: string;
  gameId: string;
  onShowSettings?: () => void;
  /** Optional game state passed from parent when using Supabase transport */
  gameState?: any;
  /** Whether sockets are disabled (using Supabase transport) */
  socketsDisabled?: boolean;
}

function CombinedTimerStats({ tableId, playerId, gameId, onShowSettings }: CombinedHUDProps) {
  // Check transport mode to determine whether to use sockets or Supabase
  const transportMode = getTransportMode();
  const useSupabase = transportMode === 'supabase';
  
  // Timer states
  const [socket, setSocket] = useState<any>(null);
  const [timer, setTimer] = useState<TimerState>(undefined);
  const [now, setNow] = useState<number>(Date.now());
  const [bank, setBank] = useState<number>(0);
  // Hand tracking refs for session stat updates
  const lastStageRef = useRef<string | undefined>(undefined);
  const lastPotRef = useRef<number>(0);
  const lastStacksRef = useRef<Record<string, number>>({});
  // New: per-hand baseline stacks captured at hand start (stack + currentBet)
  const handStartStacksRef = useRef<Record<string, number>>({});

  // Session stats states
  const [sessionStats, setSessionStats] = useState<SessionStats>({
    handsPlayed: 0,
    handsWon: 0,
    totalWinnings: 0,
    totalLosses: 0,
    biggestPotWon: 0,
    foldRate: 0,
    sessionStartTime: new Date(),
    timeInSession: '0m'
  });
  const [statsLoading, setStatsLoading] = useState(true);

  // Hand/session stat updater: process game state updates
  const processGameStateUpdate = useCallback((payload: { gameState: any; lastAction?: any }) => {
    const gs = payload?.gameState;
    if (!gs) return;

    const prevStage = lastStageRef.current;
    const currStage = gs.stage;

    // Check for game_started action (from lastAction) to initialize tracking
    if (payload.lastAction?.action === 'game_started' || (prevStage === undefined && currStage)) {
      // Initialize tracking snapshots from initial state
      lastStageRef.current = gs.stage;
      lastPotRef.current = gs.pot || 0;
      const stacks: Record<string, number> = {};
      (gs.players || []).forEach((p: any) => (stacks[p.id] = p.stack || 0));
      lastStacksRef.current = stacks;
      // Initialize hand-start baselines: approximate start-of-hand as (stack + currentBet)
      const handStart: Record<string, number> = {};
      (gs.players || []).forEach((p: any) => (handStart[p.id] = (p.stack || 0) + (p.currentBet || 0)));
      handStartStacksRef.current = handStart;
      console.log('[stats] Game started - initialized tracking', { stage: gs.stage, stacks, handStart });
      return;
    }

    // Detect new hand start: transition to preflop (reset hand-start baseline)
    if (currStage === 'preflop' && prevStage !== 'preflop') {
      const handStart: Record<string, number> = {};
      (gs.players || []).forEach((p: any) => (handStart[p.id] = (p.stack || 0) + (p.currentBet || 0)));
      try { console.log('[stats] New hand baseline set', handStart); } catch {}
      handStartStacksRef.current = handStart;
    }

    // When a hand transitions into showdown, treat as hand completion
    if (prevStage !== 'showdown' && currStage === 'showdown') {
      try {
        const stacksNow: Record<string, number> = {};
        (gs.players || []).forEach((p: any) => (stacksNow[p.id] = p.stack || 0));
        // Prefer per-hand baseline (stack + currentBet at hand start); fallback to last-stage snapshot
        const myBaseline = handStartStacksRef.current[playerId];
        const myPrev = typeof myBaseline === 'number' ? myBaseline : lastStacksRef.current[playerId];
        const myNow = stacksNow[playerId];
        if (typeof myPrev === 'number' && typeof myNow === 'number') {
          const delta = myNow - myPrev;
          // Biggest Pot Won: only track positive winnings for the hand
          const wonAmount = delta > 0 ? delta : 0;
          const iFolded = !!(gs.players?.find((p: any) => p.id === playerId)?.folded || gs.players?.find((p: any) => p.id === playerId)?.isFolded);
          try { console.log('[stats] Hand complete. baseline:', myPrev, 'now:', myNow, 'delta:', delta, 'wonAmount:', wonAmount, 'folded:', iFolded); } catch {}

          setSessionStats(prev => {
            const next = { ...prev };
            next.handsPlayed = (prev.handsPlayed || 0) + 1;
            if (delta > 0) {
              next.handsWon = (prev.handsWon || 0) + 1;
              next.totalWinnings = (prev.totalWinnings || 0) + delta;
              next.biggestPotWon = Math.max((prev as any).biggestPotWon || 0, wonAmount);
            } else if (delta < 0) {
              next.totalLosses = (prev.totalLosses || 0) + Math.abs(delta);
              // Do not update biggestPotWon on losses
            } else {
              // No net change; do not update biggestPotWon
            }
            // Approximate fold rate similar to PlayerStats component
            // Prefer using folded flag when available; otherwise fall back to (handsPlayed - handsWon)/handsPlayed
            if (iFolded) {
              const foldsSoFar = Math.round(((prev.foldRate || 0) / 100) * (prev.handsPlayed || 0));
              const newFolds = foldsSoFar + 1;
              next.foldRate = Math.floor((newFolds / next.handsPlayed) * 100);
            } else {
              next.foldRate = Math.floor(((next.handsPlayed - next.handsWon) / next.handsPlayed) * 100);
            }

            // Persist
            try {
              localStorage.setItem(`session_stats_${gameId}`, JSON.stringify(next));
            } catch {}
            return next;
          });
        }
      } catch (e) {
        console.warn('Failed to update session stats on showdown:', e);
      }
    }

    // Update snapshots for next transition
    lastStageRef.current = currStage;
    lastPotRef.current = gs.pot || 0;
    const stacks: Record<string, number> = {};
    (gs.players || []).forEach((p: any) => (stacks[p.id] = p.stack || 0));
    lastStacksRef.current = stacks;
  }, [playerId, gameId]);

  // Subscribe to Supabase realtime updates when in Supabase mode
  useSupabaseRealtime(
    useSupabase ? tableId : undefined,
    {
      onGameStateUpdate: (payload: any) => {
        console.log('[stats] Supabase game_state_update received:', payload?.gameState?.stage);
        processGameStateUpdate(payload);
      }
    }
  );

  // Timer socket initialization (only when not using Supabase)
  useEffect(() => {
    if (useSupabase) return;
    
    const initSocket = async () => {
      try {
        const { getSocket } = await import('../lib/clientSocket');
        const socketInstance = await getSocket();
        setSocket(socketInstance);
      } catch (error) {
        console.warn('Timer socket initialization failed, continuing without real-time timer:', error);
      }
    };
    
    setTimeout(() => {
      initSocket();
    }, 300);
  }, [useSupabase]);

  // Timer socket events (only when not using Supabase)
  useEffect(() => {
    if (useSupabase || !socket) return;
    
    const onTimer = (state?: any) => setTimer(state);
    const onBank = ({ amount }: { amount: number }) => setBank(amount);
    // Hand/session stat updater: listen for game lifecycle
    const onGameStarted = (data: { gameState?: any }) => {
      console.log('[stats] Socket game_started received');
      processGameStateUpdate({ gameState: data?.gameState, lastAction: { action: 'game_started' } });
    };

    const onGameStateUpdate = (payload: { gameState: any }) => {
      console.log('[stats] Socket game_state_update received:', payload?.gameState?.stage);
      processGameStateUpdate(payload);
    };
    
    socket.on('timer_update', onTimer);
    socket.on('timebank_update', onBank);
    socket.on('game_started', onGameStarted);
    socket.on('game_state_update', onGameStateUpdate);
    return () => {
      socket?.off('timer_update', onTimer);
      socket?.off('timebank_update', onBank);
      socket?.off('game_started', onGameStarted);
      socket?.off('game_state_update', onGameStateUpdate);
    };
  }, [socket, useSupabase, processGameStateUpdate]);

  // Timer countdown
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);

  // Session stats initialization
  useEffect(() => {
    const initializeSessionStats = async () => {
      try {
        const savedStats = localStorage.getItem(`session_stats_${gameId}`);
        if (savedStats) {
          const parsed = JSON.parse(savedStats);
          // Migrate older schemas: if biggestPotWon is missing, initialize to 0 (do not reuse legacy 'biggestPot')
          const migrated: SessionStats = {
            handsPlayed: parsed.handsPlayed ?? 0,
            handsWon: parsed.handsWon ?? 0,
            totalWinnings: parsed.totalWinnings ?? 0,
            totalLosses: parsed.totalLosses ?? 0,
            biggestPotWon: typeof parsed.biggestPotWon === 'number' ? parsed.biggestPotWon : 0,
            foldRate: parsed.foldRate ?? 0,
            sessionStartTime: new Date(parsed.sessionStartTime ?? new Date()),
            timeInSession: parsed.timeInSession ?? '0m'
          };
          setSessionStats(migrated);
        } else {
          const newSession = {
            handsPlayed: 0,
            handsWon: 0,
            totalWinnings: 0,
            totalLosses: 0,
            biggestPotWon: 0,
            foldRate: 0,
            sessionStartTime: new Date(),
            timeInSession: '0m'
          };
          setSessionStats(newSession);
          localStorage.setItem(`session_stats_${gameId}`, JSON.stringify(newSession));
        }
      } catch (error) {
        console.error('Error initializing session stats:', error);
      } finally {
        setStatsLoading(false);
      }
    };

    initializeSessionStats();
  }, [gameId]);

  // Session time calculation
  useEffect(() => {
    const updateTimer = () => {
      const now = new Date();
      const diff = now.getTime() - sessionStats.sessionStartTime.getTime();
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(minutes / 60);
      
      if (hours > 0) {
        setSessionStats(prev => ({
          ...prev,
          timeInSession: `${hours}h ${minutes % 60}m`
        }));
      } else {
        setSessionStats(prev => ({
          ...prev,
          timeInSession: `${minutes}m`
        }));
      }
    };

    const timer = setInterval(updateTimer, 60000);
    updateTimer();
    return () => clearInterval(timer);
  }, [sessionStats.sessionStartTime]);

  // Timer calculations
  const remainingMs = useMemo(() => {
    if (!timer) return 0;
    const end = timer.startTime + timer.duration;
    return Math.max(0, end - now);
  }, [timer, now]);

  const isMyTurn = timer && timer.activePlayer === playerId;
  const seconds = Math.ceil(remainingMs / 1000);

  const useTimeBank = () => {
    socket?.emit('use_timebank', { tableId, playerId });
  };

  const calculateWinRate = () => {
    if (sessionStats.handsPlayed === 0) return 0;
    return Math.round((sessionStats.handsWon / sessionStats.handsPlayed) * 100);
  };

  const calculateNetWinnings = () => {
    return sessionStats.totalWinnings - sessionStats.totalLosses;
  };

  const formatCurrency = (val: number) => {
    // Ensure negatives show with a leading minus: -$5 rather than $-5
    const abs = Math.abs(val);
    const formatted = `$${abs}`;
    return val < 0 ? `-${formatted}` : formatted;
  };

  if (statsLoading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-16 bg-gray-200 dark:bg-gray-700 rounded"></div>
        <div className="h-16 bg-gray-200 dark:bg-gray-700 rounded"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Session Statistics Section */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Session Statistics
          </h3>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {sessionStats.timeInSession}
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-2 text-sm">
          {/* Top row */}
          <div className="bg-blue-50 dark:bg-blue-900/20 p-2 rounded">
            <div className="text-xs text-gray-600 dark:text-gray-400">Hands</div>
            <div className="font-bold text-blue-600 dark:text-blue-400">
              {sessionStats.handsPlayed}
            </div>
          </div>
          
          <div className="bg-green-50 dark:bg-green-900/20 p-2 rounded">
            <div className="text-xs text-gray-600 dark:text-gray-400">Win Rate</div>
            <div className="font-bold text-green-600 dark:text-green-400">
              {calculateWinRate()}%
            </div>
          </div>

          {/* Bottom row */}
          <div className="bg-indigo-50 dark:bg-indigo-900/20 p-2 rounded">
            <div className="text-xs text-gray-600 dark:text-gray-400">Net</div>
            <div className={`font-bold ${calculateNetWinnings() >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {formatCurrency(calculateNetWinnings())}
            </div>
          </div>

          <div className="bg-purple-50 dark:bg-purple-900/20 p-2 rounded">
            <div className="text-xs text-gray-600 dark:text-gray-400">Biggest Pot Won</div>
            <div className="font-bold text-purple-600 dark:text-purple-400">
              {formatCurrency(Math.max(0, sessionStats.biggestPotWon || 0))}
            </div>
          </div>
        </div>

        <div className="mt-3 pt-2 border-t border-gray-200 dark:border-gray-600">
          <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
            Started at {sessionStats.sessionStartTime.toLocaleTimeString()}
          </div>
        </div>

        {/* Settings button placed below Session Statistics */}
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onShowSettings}
            className="px-3 py-2 rounded bg-gray-900 text-white hover:bg-gray-800 dark:bg-gray-700 dark:hover:bg-gray-600"
          >
            Show Settings
          </button>
        </div>
      </div>
    </div>
  );
}

export default memo(CombinedTimerStats);