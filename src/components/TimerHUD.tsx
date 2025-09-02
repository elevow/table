import { useEffect, useMemo, useState } from 'react';
import { getSocket } from '../lib/clientSocket';

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
  const socket = useMemo(getSocket, []);
  const [timer, setTimer] = useState<TimerState>(undefined);
  const [now, setNow] = useState<number>(Date.now());
  const [bank, setBank] = useState<number>(0);

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
      <div className={`px-2 py-1 rounded ${timer?.warning ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-100 text-gray-800'}`}>
        Time left: {seconds}s
      </div>
      <div className="px-2 py-1 rounded bg-blue-50 text-blue-800">
        Bank: {bank / 1000}s
      </div>
      {isMyTurn && bank > 0 && (
        <button
          className="px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
          onClick={useTimeBank}
        >
          Use Time Bank
        </button>
      )}
    </div>
  );
}
