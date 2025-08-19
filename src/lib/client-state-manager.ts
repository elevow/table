import { Socket } from 'socket.io-client';
import { TableState } from '../types/poker';
import { StateUpdate, StateReconciliation } from '../types/state-update';

export class ClientStateManager {
  private state: TableState | null = null;
  private sequence: number = 0;
  private pendingUpdates: Map<number, Partial<TableState>> = new Map();
  private socket: Socket;
  private onStateChange: (state: TableState) => void;
  private reconnectAttempts: number = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly RECONNECT_DELAY = 1000;
  private connectionStatus: 'connected' | 'disconnected' | 'reconnecting' = 'disconnected';

  constructor(socket: typeof Socket, onStateChange: (state: TableState) => void) {
    this.socket = socket;
    this.onStateChange = onStateChange;
    this.setupSocketHandlers();
    this.setupErrorHandling();
  }

  private setupSocketHandlers(): void {
    this.socket.on('state_update', (update: StateUpdate) => {
      this.handleStateUpdate(update);
    });

    this.socket.on('reconcile', (reconciliation: StateReconciliation) => {
      this.handleReconciliation(reconciliation);
    });

    this.socket.on('connect', () => {
      this.connectionStatus = 'connected';
      this.reconnectAttempts = 0;
      this.requestReconciliation();
    });

    this.socket.on('disconnect', () => {
      this.connectionStatus = 'disconnected';
      this.handleDisconnect();
    });

    this.socket.on('connect_error', (error: Error) => {
      // Only log in non-CI environments
      if (!process.env.CI) {
        console.error('Connection error:', error);
      }
      this.handleConnectionError();
    });
  }

  private setupErrorHandling(): void {
    window.addEventListener('online', () => {
      if (this.connectionStatus === 'disconnected') {
        this.attemptReconnect();
      }
    });
  }

  private handleDisconnect(): void {
    this.connectionStatus = 'disconnected';
    this.attemptReconnect();
  }

  private handleConnectionError(): void {
    if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
      this.connectionStatus = 'reconnecting';
      this.reconnectAttempts++;
      this.socket.connect();
    } else {
      this.connectionStatus = 'disconnected';
      console.error('Max reconnection attempts reached');
    }
  }

  private attemptReconnect(): void {
    if (this.connectionStatus === 'reconnecting') {
      return;
    }

    this.connectionStatus = 'reconnecting';
    this.reconnectAttempts++;

    setTimeout(() => {
      this.socket.connect();
    }, this.RECONNECT_DELAY * Math.min(this.reconnectAttempts, 5));
  }

  private handleStateUpdate(update: StateUpdate): void {
    if (update.sequence <= this.sequence) {
      return; // Ignore old updates
    }

    if (update.sequence > this.sequence + 1) {
      // We missed some updates, request reconciliation
      this.requestReconciliation();
      return;
    }

    this.applyUpdate(update.payload);
    this.sequence = update.sequence;
  }

  private handleReconciliation(reconciliation: StateReconciliation): void {
    // Reset state to server's version
    this.state = reconciliation.fullState;
    this.sequence = reconciliation.serverSequence;

    // Reapply any pending updates that came after the reconciliation point
    this.pendingUpdates.forEach((update, seq) => {
      if (seq > reconciliation.serverSequence) {
        this.applyUpdate(update);
      }
    });

    this.notifyStateChange();
  }

  private applyUpdate(update: Partial<TableState>): void {
    if (!this.state) {
      this.state = update as TableState;
    } else {
      this.state = { ...this.state, ...update };
    }
    this.notifyStateChange();
  }

  public optimisticUpdate(update: Partial<TableState>): void {
    const nextSequence = this.sequence + 1;
    this.pendingUpdates.set(nextSequence, update);
    this.applyUpdate(update);
  }

  private requestReconciliation(): void {
    this.socket.emit('request_reconciliation', {
      tableId: this.state?.tableId,
      sequence: this.sequence
    });
  }

  private notifyStateChange(): void {
    if (this.state) {
      this.onStateChange(this.state);
    }
  }

  public getState(): TableState | null {
    return this.state;
  }

  public getSequence(): number {
    return this.sequence;
  }
}
