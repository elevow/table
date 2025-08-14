import { StateChange, VersionedState } from './types';
import { StateConflict } from '../../types/state';

export class ReconciliationManager<T extends Record<string, any>> {
  private conflictHandlers: Map<string, (conflict: StateConflict, state: VersionedState<T>) => VersionedState<T>>;

  constructor() {
    this.conflictHandlers = new Map();
  }

  public registerConflictHandler(
    type: string, 
    handler: (conflict: StateConflict, state: VersionedState<T>) => VersionedState<T>
  ): void {
    this.conflictHandlers.set(type, handler);
  }

  public detectConflicts(
    clientState: VersionedState<T>, 
    serverState: VersionedState<T>
  ): StateConflict[] {
    const conflicts: StateConflict[] = [];

    // Version mismatch conflict
    if (clientState.version !== serverState.version) {
      conflicts.push({
        clientVersion: clientState.version,
        serverVersion: serverState.version,
        conflictType: 'merge',
        resolution: 'server'
      });
    }

    // Changed data conflicts
    for (const clientChange of clientState.changes) {
      const serverChange = serverState.changes.find(
        c => c.id === clientChange.id
      );

      if (serverChange && serverChange.timestamp > clientChange.timestamp) {
        conflicts.push({
          clientVersion: clientState.version,
          serverVersion: serverState.version,
          conflictType: 'override',
          resolution: 'server'
        });
      }
    }

    return conflicts;
  }

  public resolveConflicts(
    clientState: VersionedState<T>,
    serverState: VersionedState<T>,
    conflicts: StateConflict[]
  ): VersionedState<T> {
    let resolvedState = { ...serverState };

    for (const conflict of conflicts) {
      const handler = this.conflictHandlers.get(conflict.conflictType);
      if (handler) {
        resolvedState = handler(conflict, resolvedState);
      } else {
        // Default resolution strategy
        switch (conflict.resolution) {
          case 'client':
            resolvedState = { ...clientState };
            break;
          case 'merge':
            resolvedState = this.mergeStates(clientState, serverState);
            break;
          case 'server':
          default:
            resolvedState = { ...serverState };
        }
      }
    }

    return resolvedState;
  }

  private mergeStates<T extends Record<string, any>>(
    clientState: VersionedState<T>, 
    serverState: VersionedState<T>
  ): VersionedState<T> {
    // Create a new state with server as base
    const mergedState = { ...serverState };

    // Apply non-conflicting client changes
    for (const clientChange of clientState.changes) {
      const serverChange = serverState.changes.find(
        c => c.id === clientChange.id
      );

      if (!serverChange || serverChange.timestamp < clientChange.timestamp) {
        this.applyChange(mergedState, clientChange);
      }
    }

    return mergedState;
  }

  private applyChange<T extends Record<string, any>>(state: VersionedState<T>, change: StateChange<any>): void {
    let target: Record<string, any> = state.data;
    
    // Navigate to the target object using the path
    for (let i = 0; i < change.path.length - 1; i++) {
      target = target[change.path[i]] as Record<string, any>;
    }

    // Apply the change
    switch (change.type) {
      case 'update':
        target[change.path[change.path.length - 1]] = change.value;
        break;
      case 'delete':
        delete target[change.path[change.path.length - 1]];
        break;
      case 'create':
        target[change.path[change.path.length - 1]] = change.value;
        break;
    }

    // Add the change to the history
    state.changes.push(change);
  }
}
