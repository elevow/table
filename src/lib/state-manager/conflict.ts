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
    }

    conflict.resolvedValue = resolvedValue;
    this.setValueAtPath(this.state.data, conflict.path, resolvedValue);
  }

  public async handleConflict(conflict: StateConflict): Promise<void> {
    if (!conflict.resolvedValue) {
      await this.resolveConflict(conflict);
    }

    // Add to change history
    this.state.changes.push({
      id: `conflict_${Date.now()}`,
      type: 'update',
      path: conflict.path.split('.'),
      value: conflict.resolvedValue,
      timestamp: Date.now(),
      source: 'server'
    });
  }

  public async mergeValues(clientValue: any, serverValue: any): Promise<any> {
    // For simple values, prefer server value
    if (typeof clientValue !== 'object' || typeof serverValue !== 'object') {
      return serverValue;
    }

    // For arrays, merge unique items
    if (Array.isArray(clientValue) && Array.isArray(serverValue)) {
      const merged = Array.from(new Set([...clientValue, ...serverValue]));
      return merged;
    }

    // For objects, deep merge
    const merged = { ...clientValue };
    for (const [key, value] of Object.entries(serverValue)) {
      if (key in clientValue && typeof clientValue[key] === 'object') {
        merged[key] = await this.mergeValues(clientValue[key], value);
      } else {
        merged[key] = value;
      }
    }

    return merged;
  }

  private getValueAtPath(obj: any, path: string): any {
    if (!path) return obj;

    const parts = path.split('.');
    let current: any = obj;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }

    return current;
  }

  private setValueAtPath(obj: any, path: string, value: any): void {
    if (!path) return;

    const parts = path.split('.');
    let current: any = obj;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!(part in current)) {
        current[part] = {};
      }
      current = current[part];
    }

    current[parts[parts.length - 1]] = value;
  }
}
