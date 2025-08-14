import { VersionedState, StateChange, StateVersioning } from './types';
import { StateManager } from './core';
import * as crypto from 'crypto';

export class VersionManager extends StateManager {
  private stateHistory: VersionedState<any>[];
  private maxHistoryLength: number;

  constructor(maxHistoryLength: number = 100) {
    super();
    this.stateHistory = [];
    this.maxHistoryLength = maxHistoryLength;
  }

  protected generateChecksum(data: any): string {
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(data));
    return hash.digest('hex');
  }

  public createVersion<T>(data: T, changes: StateChange<any>[] = []): VersionedState<T> {
    const version: VersionedState<T> = {
      version: this.version++,
      timestamp: Date.now(),
      checksum: this.generateChecksum(data),
      data,
      changes,
      lastSync: Date.now()
    };

    this.addToHistory(version);
    return version;
  }

  private addToHistory<T>(version: VersionedState<T>): void {
    this.stateHistory.push(version);
    if (this.stateHistory.length > this.maxHistoryLength) {
      this.stateHistory.shift();
    }
  }

  public getVersion(version: number): VersionedState<any> | null {
    return this.stateHistory.find(v => v.version === version) || null;
  }

  public getVersionRange(fromVersion: number, toVersion: number): VersionedState<any>[] {
    return this.stateHistory.filter(v => 
      v.version >= fromVersion && v.version <= toVersion
    );
  }

  public compareVersions(v1: number, v2: number): StateChange<any>[] {
    const version1 = this.getVersion(v1);
    const version2 = this.getVersion(v2);
    
    if (!version1 || !version2) {
      throw new Error('Version not found');
    }

    return version2.changes;
  }
}
