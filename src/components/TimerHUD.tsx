import { useEffect, useMemo, useState } from 'react';

type TimerState = {
  activePlayer: string;
  startTime: number;
  duration: number;
  timeBank: number;
  warning: boolean;
} | undefined;

interface TimerHUDProps {
  tableId: string;
  playerId: string;
}

export default function TimerHUD({ tableId, playerId }: TimerHUDProps) {
  const [socket, setSocket] = useState<any>(null);
  const [timer, setTimer] = useState<TimerState>(undefined);
  const [now, setNow] = useState<number>(Date.now());
  const [bank, setBank] = useState<number>(0);

  useEffect(() => {
    // Initialize socket connection (non-blocking)
    const initSocket = async () => {
      try {
        const { getSocket } = await import('../lib/clientSocket');
        const socketInstance = await getSocket();
        setSocket(socketInstance);
      } catch (error) {
        console.warn('Timer socket initialization failed, continuing without real-time timer:', error);
      }
    };
    
    // Don't block page load for socket initialization
    setTimeout(() => {
      initSocket();
    }, 300);
  }, []);

  useEffect(() => {
    const onTimer = (state?: any) => setTimer(state);
    const onBank = ({ amount }: { amount: number }) => setBank(amount);

    if (!socket) return;
    socket.on('timer_update', onTimer);
    socket.on('timebank_update', onBank);
    return () => {
      socket?.off('timer_update', onTimer);
      socket?.off('timebank_update', onBank);
    };
  }, [socket]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);

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

  return (
    <div className="flex items-center gap-3 text-sm">
      <div className={`px-2 py-1 rounded ${timer?.warning ? 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200' : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'}`}>
        Time left: {seconds}s
      </div>
      <div className="px-2 py-1 rounded bg-blue-50 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
        Bank: {bank / 1000}s
      </div>
      {isMyTurn && bank > 0 && (
        <button
          className="px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
          onClick={useTimeBank}
        >
          Use Time Bank
        </button>
      )}
    </div>
  );
}
