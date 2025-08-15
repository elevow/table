import { StateDelta, StateConflict } from '../../types/state';
import { TableState } from '../../types/poker';
import { IConflictManager, VersionedState, StateSyncOptions } from './types';

export class ConflictManager implements IConflictManager {
  constructor(
    private readonly state: VersionedState<TableState>,
    private readonly config: StateSyncOptions
  ) {}

  public detectConflicts(delta: StateDelta): StateConflict[] {
    const conflicts: StateConflict[] = [];

    // Check version conflicts
    if (delta.from !== this.state.version) {
      conflicts.push({
        clientVersion: this.state.version,
        serverVersion: delta.from,
        conflictType: 'merge',
        resolution: this.config.conflictResolution,
        path: '',
        clientValue: this.state.data,
        serverValue: null, // Will be set during resolution
        resolvedValue: null
      });
    }

    // Check state changes conflicts
    for (const change of delta.changes) {
      const clientValue = this.getValueAtPath(this.state.data, change.path);
      if (clientValue !== change.oldValue) {
        conflicts.push({
          clientVersion: this.state.version,
          serverVersion: delta.from,
          conflictType: 'override',
          resolution: this.config.conflictResolution,
          path: change.path,
          clientValue,
          serverValue: change.newValue,
          resolvedValue: null
        });
      }
    }

    return conflicts;
  }

  public async resolveConflict(conflict: StateConflict): Promise<void> {
    let resolvedValue: any;
    const isCriticalPath = conflict.path?.includes('activePlayer') || 
                          conflict.path?.includes('stage') ||
                          conflict.path?.includes('pot') ||
                          conflict.path?.includes('dealerPosition') ||
                          conflict.path?.includes('communityCards');

    // For critical game state, always use server value
    if (isCriticalPath) {
      resolvedValue = conflict.serverValue;
    } else {
      switch (conflict.resolution) {
        case 'client':
          resolvedValue = conflict.clientValue;
          break;
        case 'server':
          resolvedValue = conflict.serverValue;
          break;
        case 'merge':
          resolvedValue = await this.mergeValues(conflict.clientValue, conflict.serverValue);
          break;
        default:
          resolvedValue = conflict.serverValue;
      }
    }

    conflict.resolvedValue = resolvedValue;
    if (conflict.path) {
      this.setValueAtPath(this.state.data, conflict.path, resolvedValue);
    } else {
      // No path means entire state update - prefer server's game state
      const mergedState = { ...conflict.clientValue, ...conflict.serverValue };
      Object.assign(this.state.data, mergedState);
    }
  }

  public async handleConflict(conflict: StateConflict): Promise<void> {
    if (!conflict.resolvedValue) {
      await this.resolveConflict(conflict);
    }

    // Update state version to match server version when using server's value
    if (conflict.resolution === 'server' || conflict.resolution === 'merge') {
      this.state.version = conflict.serverVersion;
      
      // Apply resolved value
      if (conflict.path) {
        this.setValueAtPath(this.state.data, conflict.path, conflict.resolvedValue);
      } else {
        // No path means entire state update
        Object.assign(this.state.data, conflict.resolvedValue);
      }
    }

    // Add to change history
    this.state.changes.push({
      id: `conflict_${Date.now()}`,
      type: 'update',
      path: conflict.path ? conflict.path.split('.') : [],
      value: conflict.resolvedValue,
      oldValue: conflict.clientValue,
      newValue: conflict.resolvedValue,
      timestamp: Date.now(),
      source: 'server'
    });
  }

  public async mergeValues(clientValue: any, serverValue: any): Promise<any> {
    // For undefined or null values from either side
    if (serverValue === undefined || serverValue === null) {
      return clientValue;
    }
    if (clientValue === undefined || clientValue === null) {
      return serverValue;
    }

    // For primitive types or dates, prefer server value
    if (typeof serverValue !== 'object' || serverValue instanceof Date) {
      return serverValue;
    }

    // For arrays, use server array
    if (Array.isArray(serverValue)) {
      return [...serverValue];
    }

    // For objects, do a deep merge
    const mergedValue = { ...clientValue };
    for (const key of Object.keys(serverValue)) {
      if (key === 'activePlayer' || 
          key === 'stage' || 
          key === 'communityCards' || 
          key === 'pot' || 
          key === 'dealerPosition') {
        // Server wins for critical game state
        mergedValue[key] = serverValue[key];
      }
    }
    return mergedValue;
  }

  private getValueAtPath(obj: any, path: string): any {
    if (!path) return obj;

    const parts = Array.isArray(path) ? path : path.split('.');
    let current: any = obj;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }

    return current;
  }

  private setValueAtPath(obj: any, path: string, value: any): void {
    if (!path) return;

    const parts = Array.isArray(path) ? path : path.split('.');
    let current: any = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current)) {
        current[part] = {};
      }
      current = current[part];
    }

    const lastPart = parts[parts.length - 1];
    current[lastPart] = value;
  }
}
