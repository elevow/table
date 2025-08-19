import { VersionedState } from './types';
import { StateChange } from '../../types/state-sync';
import { IChecksumProvider, ITimeProvider, IVersionHistoryManager, IVersionCounter } from './version-interfaces';
import * as crypto from 'crypto';

/**
 * Default implementation of checksumming functionality
 */
export class DefaultChecksumProvider implements IChecksumProvider {
  public generateChecksum(data: any): string {
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify(data));
    return hash.digest('hex');
  }
}

/**
 * Default implementation of time provider
 */
export class DefaultTimeProvider implements ITimeProvider {
  public getCurrentTimestamp(): number {
    return Date.now();
  }
}

/**
 * Default implementation of version counter
 */
export class DefaultVersionCounter implements IVersionCounter {
  private version: number;

  constructor(initialVersion: number = 0) {
    this.version = initialVersion;
  }

  public getCurrentVersion(): number {
    return this.version;
  }

  public getNextVersion(): number {
    const currentVersion = this.version;
    this.version += 1;
    return currentVersion;
  }
}

/**
 * Core implementation of version history management functionality
 * This class is independent of StateManager and handles the versioning logic
 */
export class VersionHistoryManager<T = any> implements IVersionHistoryManager<T> {
  private stateHistory: VersionedState<any>[];
  private maxHistoryLength: number;
  private checksumProvider: IChecksumProvider;
  private timeProvider: ITimeProvider;
  private versionCounter: IVersionCounter;

  constructor(
    maxHistoryLength: number = 100,
    checksumProvider: IChecksumProvider = new DefaultChecksumProvider(),
    timeProvider: ITimeProvider = new DefaultTimeProvider(),
    versionCounter: IVersionCounter = new DefaultVersionCounter()
  ) {
    this.stateHistory = [];
    this.maxHistoryLength = maxHistoryLength;
    this.checksumProvider = checksumProvider;
    this.timeProvider = timeProvider;
    this.versionCounter = versionCounter;
  }

  public createVersion(data: T, changes: StateChange[] = []): VersionedState<T> {
    const version: VersionedState<T> = {
      version: this.versionCounter.getNextVersion(),
      timestamp: this.timeProvider.getCurrentTimestamp(),
      checksum: this.checksumProvider.generateChecksum(data),
      data,
      changes,
      lastSync: this.timeProvider.getCurrentTimestamp()
    };

    this.addToHistory(version);
    return version;
  }

  private addToHistory<U>(version: VersionedState<U>): void {
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

  public compareVersions(v1: number, v2: number): StateChange[] {
    const version1 = this.getVersion(v1);
    const version2 = this.getVersion(v2);
    
    if (!version1 || !version2) {
      throw new Error('Version not found');
    }

    return version2.changes;
  }
}
