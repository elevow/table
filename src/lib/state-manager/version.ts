import { VersionedState, StateManagerConfig } from './types';
import { StateChange } from '../../types/state-sync';
import { StateManager } from './core';
import { 
  IVersionHistoryManager, 
  IChecksumProvider, 
  ITimeProvider, 
  IVersionCounter 
} from './version-interfaces';
import { 
  VersionHistoryManager, 
  DefaultChecksumProvider, 
  DefaultTimeProvider, 
  DefaultVersionCounter 
} from './version-history';

/**
 * Refactored VersionManager that uses dependency injection
 * and delegates core version management to VersionHistoryManager
 */
export class VersionManager extends StateManager {
  private versionHistoryManager: IVersionHistoryManager;

  constructor(
    config: StateManagerConfig,
    maxHistoryLength: number = 100,
    checksumProvider: IChecksumProvider = new DefaultChecksumProvider(),
    timeProvider: ITimeProvider = new DefaultTimeProvider(),
    versionCounter: IVersionCounter = new DefaultVersionCounter(),
    versionHistoryManager?: IVersionHistoryManager
  ) {
    super(config);

    // Either use the provided version history manager or create a new one
    this.versionHistoryManager = versionHistoryManager || 
      new VersionHistoryManager(
        maxHistoryLength,
        checksumProvider,
        timeProvider,
        versionCounter
      );
  }

  /**
   * Creates a new versioned state
   */
  public createVersion<T>(data: T, changes: StateChange[] = []): VersionedState<T> {
    return this.versionHistoryManager.createVersion(data, changes);
  }

  /**
   * Retrieves a specific version by version number
   * This is separate from getVersion() in StateManager which returns the current version number
   */
  public getVersionState(version: number): VersionedState<any> | null {
    return this.versionHistoryManager.getVersion(version);
  }

  /**
   * Retrieves versions within a specified range
   */
  public getVersionRange(fromVersion: number, toVersion: number): VersionedState<any>[] {
    return this.versionHistoryManager.getVersionRange(fromVersion, toVersion);
  }

  /**
   * Compares two versions and returns the changes between them
   */
  public compareVersions(v1: number, v2: number): StateChange[] {
    return this.versionHistoryManager.compareVersions(v1, v2);
  }
}
