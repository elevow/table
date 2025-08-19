import { VersionedState } from '../types';
import { StateChange } from '../../../types/state-sync';
import { 
  VersionHistoryManager, 
  DefaultChecksumProvider, 
  DefaultTimeProvider, 
  DefaultVersionCounter 
} from '../version-history';
import * as crypto from 'crypto';

// Mock the crypto module
jest.mock('crypto', () => ({
  createHash: jest.fn().mockReturnValue({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue('mockedHash123')
  })
}));

describe('VersionHistoryManager', () => {
  let versionHistoryManager: VersionHistoryManager;
  let mockChecksumProvider: { generateChecksum: jest.Mock };
  let mockTimeProvider: { getCurrentTimestamp: jest.Mock };
  let mockVersionCounter: { getCurrentVersion: jest.Mock; getNextVersion: jest.Mock };
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock dependencies
    mockChecksumProvider = { generateChecksum: jest.fn().mockReturnValue('mock-checksum') };
    mockTimeProvider = { getCurrentTimestamp: jest.fn().mockReturnValue(1234567890) };
    mockVersionCounter = { 
      getCurrentVersion: jest.fn().mockReturnValue(0),
      getNextVersion: jest.fn().mockImplementation(() => 1) 
    };
    
    // Create VersionHistoryManager with mock dependencies
    versionHistoryManager = new VersionHistoryManager(
      100,
      mockChecksumProvider,
      mockTimeProvider,
      mockVersionCounter
    );
  });
  
  describe('Constructor', () => {
    it('should initialize with default values if not provided', () => {
      const defaultManager = new VersionHistoryManager();
      expect((defaultManager as any).maxHistoryLength).toBe(100);
      expect((defaultManager as any).stateHistory).toEqual([]);
      expect((defaultManager as any).checksumProvider).toBeInstanceOf(DefaultChecksumProvider);
      expect((defaultManager as any).timeProvider).toBeInstanceOf(DefaultTimeProvider);
      expect((defaultManager as any).versionCounter).toBeInstanceOf(DefaultVersionCounter);
    });
    
    it('should initialize with provided values', () => {
      expect((versionHistoryManager as any).maxHistoryLength).toBe(100);
      expect((versionHistoryManager as any).stateHistory).toEqual([]);
      expect((versionHistoryManager as any).checksumProvider).toBe(mockChecksumProvider);
      expect((versionHistoryManager as any).timeProvider).toBe(mockTimeProvider);
      expect((versionHistoryManager as any).versionCounter).toBe(mockVersionCounter);
    });
  });
  
  describe('createVersion', () => {
    it('should create a new version using the provided dependencies', () => {
      const data = { test: 'data' };
      
      const version = versionHistoryManager.createVersion(data);
      
      expect(mockChecksumProvider.generateChecksum).toHaveBeenCalledWith(data);
      expect(mockTimeProvider.getCurrentTimestamp).toHaveBeenCalledTimes(2); // Once for timestamp, once for lastSync
      expect(mockVersionCounter.getNextVersion).toHaveBeenCalledTimes(1);
      
      expect(version).toEqual({
        version: 1,
        timestamp: 1234567890,
        checksum: 'mock-checksum',
        data,
        changes: [],
        lastSync: 1234567890
      });
    });
    
    it('should create a new version with provided changes', () => {
      const data = { test: 'data' };
      const changes: StateChange[] = [
        { 
          id: 'change1', 
          type: 'update', 
          path: ['test'], 
          value: 'data', 
          timestamp: Date.now(),
          source: 'client',
          oldValue: null,
          newValue: 'data'
        }
      ];
      
      const version = versionHistoryManager.createVersion(data, changes);
      
      expect(version.changes).toEqual(changes);
    });
    
    it('should add the new version to history', () => {
      const data = { test: 'data' };
      const addToHistorySpy = jest.spyOn(versionHistoryManager as any, 'addToHistory');
      
      const version = versionHistoryManager.createVersion(data);
      
      expect(addToHistorySpy).toHaveBeenCalledWith(version);
      expect((versionHistoryManager as any).stateHistory).toContain(version);
    });
  });
  
  describe('getVersion', () => {
    it('should return the version with the specified version number', () => {
      // Add versions to the history directly
      const version1 = versionHistoryManager.createVersion({ id: 1 });
      mockVersionCounter.getNextVersion.mockReturnValue(2);
      const version2 = versionHistoryManager.createVersion({ id: 2 });
      
      // Override the stateHistory property for this test
      (versionHistoryManager as any).stateHistory = [
        { ...version1, version: 1 },
        { ...version2, version: 2 }
      ];
      
      const retrievedVersion = versionHistoryManager.getVersion(1);
      
      expect(retrievedVersion?.data).toEqual({ id: 1 });
    });
    
    it('should return null if version is not found', () => {
      const retrievedVersion = versionHistoryManager.getVersion(999);
      
      expect(retrievedVersion).toBeNull();
    });
  });
  
  describe('getVersionRange', () => {
    it('should return versions within the specified range', () => {
      const version1 = { ...versionHistoryManager.createVersion({ id: 1 }), version: 1 };
      mockVersionCounter.getNextVersion.mockReturnValue(2);
      const version2 = { ...versionHistoryManager.createVersion({ id: 2 }), version: 2 };
      mockVersionCounter.getNextVersion.mockReturnValue(3);
      const version3 = { ...versionHistoryManager.createVersion({ id: 3 }), version: 3 };
      
      // Override the stateHistory directly
      (versionHistoryManager as any).stateHistory = [version1, version2, version3];
      
      const range = versionHistoryManager.getVersionRange(1, 2);
      
      expect(range.length).toBe(2);
      expect(range[0].data).toEqual({ id: 1 });
      expect(range[1].data).toEqual({ id: 2 });
    });
    
    it('should return empty array if no versions in range', () => {
      const range = versionHistoryManager.getVersionRange(100, 200);
      
      expect(range).toEqual([]);
    });
  });
  
  describe('compareVersions', () => {
    it('should return changes between versions', () => {
      const changes1: StateChange[] = [{ 
        id: 'change1', 
        type: 'update', 
        path: ['test'], 
        value: 'data1', 
        timestamp: Date.now(),
        source: 'client',
        oldValue: null,
        newValue: 'data1'
      }];
      
      const changes2: StateChange[] = [{ 
        id: 'change2', 
        type: 'update', 
        path: ['test'], 
        value: 'data2', 
        timestamp: Date.now(),
        source: 'client',
        oldValue: 'data1',
        newValue: 'data2'
      }];
      
      // Mock getVersion to return our test versions
      jest.spyOn(versionHistoryManager, 'getVersion')
        .mockImplementation((v) => {
          if (v === 1) return { 
            version: 1, 
            data: { test: 'data1' }, 
            changes: changes1,
            timestamp: 1234567890,
            checksum: 'mock-checksum',
            lastSync: 1234567890
          };
          if (v === 2) return { 
            version: 2, 
            data: { test: 'data2' }, 
            changes: changes2,
            timestamp: 1234567891,
            checksum: 'mock-checksum-2',
            lastSync: 1234567891
          };
          return null;
        });
      
      const compareResult = versionHistoryManager.compareVersions(1, 2);
      
      expect(compareResult).toEqual(changes2);
    });
    
    it('should throw error if version is not found', () => {
      // Mock getVersion to return null for certain versions
      jest.spyOn(versionHistoryManager, 'getVersion')
        .mockImplementation((v) => {
          if (v === 1) return { 
            version: 1, 
            data: { test: 'data1' }, 
            changes: [],
            timestamp: 1234567890,
            checksum: 'mock-checksum',
            lastSync: 1234567890
          };
          return null;
        });
      
      expect(() => versionHistoryManager.compareVersions(1, 999)).toThrow('Version not found');
    });
  });
});

// Test the default implementations of the interfaces
describe('Default Implementations', () => {
  describe('DefaultChecksumProvider', () => {
    it('should generate a checksum for given data', () => {
      const checksumProvider = new DefaultChecksumProvider();
      const data = { test: 'data' };
      
      const checksum = checksumProvider.generateChecksum(data);
      
      expect(checksum).toBe('mockedHash123');
      expect(crypto.createHash).toHaveBeenCalledWith('sha256');
      const mockUpdate = crypto.createHash('sha256').update as jest.Mock;
      expect(mockUpdate).toHaveBeenCalledWith(JSON.stringify(data));
      const mockDigest = crypto.createHash('sha256').digest as jest.Mock;
      expect(mockDigest).toHaveBeenCalledWith('hex');
    });
  });
  
  describe('DefaultTimeProvider', () => {
    it('should return the current timestamp', () => {
      const timeProvider = new DefaultTimeProvider();
      const realDateNow = Date.now;
      
      try {
        // Mock Date.now
        const mockTimestamp = 1234567890;
        Date.now = jest.fn().mockReturnValue(mockTimestamp);
        
        const timestamp = timeProvider.getCurrentTimestamp();
        
        expect(timestamp).toBe(mockTimestamp);
        expect(Date.now).toHaveBeenCalled();
      } finally {
        // Restore original Date.now
        Date.now = realDateNow;
      }
    });
  });
  
  describe('DefaultVersionCounter', () => {
    it('should initialize with default version', () => {
      const versionCounter = new DefaultVersionCounter();
      
      expect(versionCounter.getCurrentVersion()).toBe(0);
    });
    
    it('should initialize with provided version', () => {
      const versionCounter = new DefaultVersionCounter(10);
      
      expect(versionCounter.getCurrentVersion()).toBe(10);
    });
    
    it('should increment version when getNextVersion is called', () => {
      const versionCounter = new DefaultVersionCounter();
      
      expect(versionCounter.getNextVersion()).toBe(0);
      expect(versionCounter.getCurrentVersion()).toBe(1);
      
      expect(versionCounter.getNextVersion()).toBe(1);
      expect(versionCounter.getCurrentVersion()).toBe(2);
    });
  });
});
