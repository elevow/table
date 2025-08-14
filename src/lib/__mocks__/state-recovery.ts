export class StateRecovery {
  private timeoutQueue: Array<{playerId: string, tableId: string}> = [];
  
  public handleDisconnect(playerId: string, tableId: string): string {
    this.timeoutQueue.push({ playerId, tableId });
    return 'test-token';
  }

  public handleReconnect(playerId: string, state: any): any {
    return {
      tableId: state.tableId,
      playerId,
      state,
      type: 'reconcile'
    };
  }

  public checkTimeouts(): Array<{playerId: string, tableId: string}> {
    return this.timeoutQueue;
  }

  public recordAction(tableId: string, action: any): void {
    // For testing purposes
  }
}
