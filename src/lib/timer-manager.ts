/**
 * TimerManager - deprecated
 * Socket.IO transport has been removed. Use HTTP APIs with Supabase realtime instead.
 * This module is kept for backward compatibility but provides minimal functionality.
 */

export class TimerManager {
  constructor(_io?: any, _stateManager?: any) {
    console.warn('⚠️ TimerManager is deprecated. Socket.IO has been removed. Use HTTP APIs with Supabase realtime instead.');
  }

  public startTimer(_tableId: string, _playerId: string, _duration: number): void {
    console.warn('⚠️ TimerManager.startTimer is deprecated.');
  }

  public stopTimer(_tableId: string): void {
    console.warn('⚠️ TimerManager.stopTimer is deprecated.');
  }

  public useTimeBank(_tableId: string, _playerId: string): boolean {
    console.warn('⚠️ TimerManager.useTimeBank is deprecated.');
    return false;
  }

  public getTimeBank(_tableId: string, _playerId: string): number {
    return 0;
  }
}
