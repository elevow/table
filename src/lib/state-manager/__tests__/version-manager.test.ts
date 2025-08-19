import { VersionManager } from '../version';
import { StateManagerConfig } from '../types';
import { VersionHistoryManager } from '../version-history';

// Mock dependencies
jest.mock('../core', () => {
  return {
    StateManager: jest.fn().mockImplementation(() => {
      return {
        getVersion: jest.fn().mockReturnValue(0),
        destroy: jest.fn()
      };
    })
  };
});

jest.mock('../version-history', () => {
  const actualModule = jest.requireActual('../version-history');
  return {
    ...actualModule,
    VersionHistoryManager: jest.fn().mockImplementation(() => {
      return {
        createVersion: jest.fn(),
        getVersion: jest.fn(),
        getVersionRange: jest.fn(),
        compareVersions: jest.fn()
      };
    })
  };
});

describe('VersionManager Integration', () => {
  let versionManager: any; // Use 'any' to bypass TypeScript checks
  let mockConfig: StateManagerConfig;
  let mockSocket: any;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup mock socket
    mockSocket = {
      on: jest.fn(),
      emit: jest.fn().mockReturnThis(),
      connect: jest.fn(),
      disconnect: jest.fn(),
    };
    
    // Setup mock config
    mockConfig = {
      socket: mockSocket,
      syncInterval: 5000,
      retryDelay: 1000,
      retryAttempts: 3,
      batchSize: 10,
      optimisticUpdates: true,
      conflictResolution: 'merge'
    };
    
    // Create VersionManager instance with explicit 'any' type to bypass TypeScript checks
    versionManager = new VersionManager(mockConfig);
  });
  
  describe('Constructor', () => {
    it('should initialize with default values', () => {
      expect(versionManager).toBeDefined();
      
      // Test that StateManager constructor was called with config
      expect(require('../core').StateManager).toHaveBeenCalledWith(mockConfig);
      
      // Test that VersionHistoryManager was created
      expect(VersionHistoryManager).toHaveBeenCalled();
    });
    
    it('should initialize with custom maxHistoryLength', () => {
      const customVersionManager = new VersionManager(mockConfig, 50);
      expect(VersionHistoryManager).toHaveBeenCalledWith(
        50, 
        expect.anything(), 
        expect.anything(), 
        expect.anything()
      );
    });
  });
});
