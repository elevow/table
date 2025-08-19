import { VersionedState } from './types';
import { StateChange } from '../../types/state-sync';

/**
 * Interface for checksumming functionality
 */
export interface IChecksumProvider {
  /**
   * Generates a checksum for the provided data
   */
  generateChecksum(data: any): string;
}

/**
 * Interface for time-related functionality
 */
export interface ITimeProvider {
  /**
   * Returns the current timestamp
   */
  getCurrentTimestamp(): number;
}

/**
 * Interface for version management core functionality
 */
export interface IVersionHistoryManager<T = any> {
  /**
   * Creates a new versioned state
   */
  createVersion(data: T, changes: StateChange[] | undefined): VersionedState<T>;
  
  /**
   * Retrieves a specific version by version number
   */
  getVersion(version: number): VersionedState<any> | null;
  
  /**
   * Retrieves versions within a specified range
   */
  getVersionRange(fromVersion: number, toVersion: number): VersionedState<any>[];
  
  /**
   * Compares two versions and returns the changes between them
   */
  compareVersions(v1: number, v2: number): StateChange[];
}

/**
 * Interface for version number generation and tracking
 */
export interface IVersionCounter {
  /**
   * Gets the current version number
   */
  getCurrentVersion(): number;
  
  /**
   * Increments and returns the next version number
   */
  getNextVersion(): number;
}
