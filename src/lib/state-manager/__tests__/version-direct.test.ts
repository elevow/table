import { VersionManager } from '../version';
import { StateManagerConfig } from '../types';
import { IVersionHistoryManager } from '../version-interfaces';

// Mock the dependencies correctly
jest.mock('../version-history', () => {
  const mockVersionHistoryManager = jest.fn().mockImplementation(() => ({
    createVersion: jest.fn(),
    getVersion: jest.fn(),
    getVersionRange: jest.fn(),
    compareVersions: jest.fn()
  }));
  
  return {
    VersionHistoryManager: mockVersionHistoryManager,
    DefaultChecksumProvider: jest.fn().mockImplementation(() => ({
      calculateChecksum: jest.fn().mockReturnValue('mock-checksum')
    })),
    DefaultTimeProvider: jest.fn().mockImplementation(() => ({
      getCurrentTime: jest.fn().mockReturnValue(Date.now())
    })),
    DefaultVersionCounter: jest.fn().mockImplementation(() => ({
      getNextVersion: jest.fn().mockReturnValue(1)
    }))
  };
});

// Mock the StateManager
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

// Import the mocked version
import { VersionHistoryManager, DefaultChecksumProvider, DefaultTimeProvider, DefaultVersionCounter } from '../version-history';

describe('VersionManager Direct Tests', () => {
  // Create a method to directly access private properties 
  const getPrivateProperty = (obj: any, prop: string) => obj[prop];
  
  // Create a test version of StateManagerConfig
  const createMockConfig = (): StateManagerConfig => ({
    socket: {
      on: jest.fn(),
      emit: jest.fn(),
      connect: jest.fn(),
      disconnect: jest.fn(),
      io: {},
      nsp: '',
      id: 'mock-id',
      connected: true,
      disconnected: false,
      open: jest.fn(),
      send: jest.fn(),
      volatile: {},
      compress: jest.fn(),
      close: jest.fn(),
      listeners: jest.fn(),
      onAny: jest.fn(),
      onAnyOutgoing: jest.fn(),
      listenersAny: jest.fn(),
      listenersAnyOutgoing: jest.fn(),
      offAny: jest.fn(),
      offAnyOutgoing: jest.fn(),
      removeListener: jest.fn(),
      off: jest.fn(),
      addListener: jest.fn(),
      once: jest.fn(),
      prependListener: jest.fn(),
      prependOnceListener: jest.fn(),
      removeAllListeners: jest.fn(),
      setMaxListeners: jest.fn(),
      getMaxListeners: jest.fn(),
      eventNames: jest.fn(),
      listenerCount: jest.fn(),
      emitWithAck: jest.fn(),
      timeout: jest.fn(),
      wait: jest.fn(),
      emitReserved: jest.fn(),
      emitUntyped: jest.fn(),
      emitWithAckReserved: jest.fn(),
      emitWithAckUntyped: jest.fn(),
      hasListeners: jest.fn(),
      rawListeners: jest.fn()
    } as any, // Use 'as any' to bypass TypeScript type checking
    syncInterval: 5000,
    retryDelay: 1000,
    retryAttempts: 3,
    batchSize: 10,
    optimisticUpdates: true,
    conflictResolution: 'merge'
  });
  
  let config: StateManagerConfig;
  
  beforeEach(() => {
    jest.clearAllMocks();
    config = createMockConfig();
  });
  
  describe('Constructor and initialization', () => {
    it('should initialize with default dependencies', () => {
      const versionManager = new VersionManager(config);
      
      // Verify the versionHistoryManager was initialized
      const versionHistoryManager = getPrivateProperty(versionManager, 'versionHistoryManager');
      expect(versionHistoryManager).toBeDefined();
      
      // Verify VersionHistoryManager was called
      expect(VersionHistoryManager).toHaveBeenCalled();
    });
    
    it('should initialize with custom history length', () => {
      const maxHistoryLength = 200;
      const versionManager = new VersionManager(config, maxHistoryLength);
      
      // VersionHistoryManager should be initialized with maxHistoryLength
      expect(VersionHistoryManager).toHaveBeenCalledWith(
        maxHistoryLength,
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
    });
    
    it('should accept custom providers', () => {
      const checksumProvider = new DefaultChecksumProvider();
      const timeProvider = new DefaultTimeProvider();
      const versionCounter = new DefaultVersionCounter();
      
      const versionManager = new VersionManager(
        config,
        100,
        checksumProvider,
        timeProvider,
        versionCounter
      );
      
      // VersionHistoryManager should be initialized with custom providers
      expect(VersionHistoryManager).toHaveBeenCalledWith(
        100,
        checksumProvider,
        timeProvider,
        versionCounter
      );
    });
    
    it('should use provided VersionHistoryManager', () => {
      const mockVersionHistoryManager: IVersionHistoryManager = {
        createVersion: jest.fn(),
        getVersion: jest.fn(),
        getVersionRange: jest.fn(),
        compareVersions: jest.fn()
      };
      
      const versionManager = new VersionManager(
        config,
        100,
        undefined,
        undefined,
        undefined,
        mockVersionHistoryManager
      );
      
      // versionHistoryManager should be set to our mock
      const versionHistoryManager = getPrivateProperty(versionManager, 'versionHistoryManager');
      expect(versionHistoryManager).toBe(mockVersionHistoryManager);
      
      // VersionHistoryManager constructor should not be called when we provide our own instance
      expect(VersionHistoryManager).not.toHaveBeenCalled();
    });
  });
});
