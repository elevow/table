import { ReconciliationManager } from './reconciliation';
import { StateConflict } from '../../types/state';
import { VersionedState, StateChange } from './types';

describe('ReconciliationManager', () => {
  interface TestState {
    name: string;
    value: number;
    nested: {
      field: string;
    };
  }

  let manager: ReconciliationManager<TestState>;
  let clientState: VersionedState<TestState>;
  let serverState: VersionedState<TestState>;

  beforeEach(() => {
    manager = new ReconciliationManager<TestState>();
    
    clientState = {
      data: {
        name: 'client',
        value: 1,
        nested: { field: 'client' }
      },
      version: 1,
      timestamp: 1000,
      checksum: 'abc',
      lastSync: 900,
      changes: [
        {
          id: '1',
          type: 'update',
          path: ['name'],
          value: 'client',
          timestamp: 950,
          source: 'client'
        }
      ]
    };

    serverState = {
      data: {
        name: 'server',
        value: 2,
        nested: { field: 'server' }
      },
      version: 2,
      timestamp: 1100,
      checksum: 'def',
      lastSync: 1000,
      changes: [
        {
          id: '2',
          type: 'update',
          path: ['value'],
          value: 2,
          timestamp: 1050,
          source: 'server'
        }
      ]
    };
  });

  describe('detectConflicts', () => {
    it('should detect version mismatch conflicts', () => {
      const conflicts = manager.detectConflicts(clientState, serverState);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toEqual({
        clientVersion: 1,
        serverVersion: 2,
        conflictType: 'merge',
        resolution: 'server'
      });
    });

    it('should detect data change conflicts', () => {
      clientState.version = 2; // Remove version conflict
      serverState.changes = [
        {
          id: '1', // Same ID as client change
          type: 'update',
          path: ['name'],
          value: 'server',
          timestamp: 1000, // Later than client change
          source: 'server'
        }
      ];

      const conflicts = manager.detectConflicts(clientState, serverState);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].conflictType).toBe('override');
    });
  });

  describe('resolveConflicts', () => {
    it('should use custom conflict handler when registered', () => {
      const customHandler = jest.fn().mockReturnValue(clientState);
      manager.registerConflictHandler('merge', customHandler);

      const conflicts: StateConflict[] = [{
        clientVersion: 1,
        serverVersion: 2,
        conflictType: 'merge',
        resolution: 'server'
      }];

      manager.resolveConflicts(clientState, serverState, conflicts);
      expect(customHandler).toHaveBeenCalled();
    });

    it('should use client state for client resolution', () => {
      const conflicts: StateConflict[] = [{
        clientVersion: 1,
        serverVersion: 2,
        conflictType: 'merge',
        resolution: 'client'
      }];

      const result = manager.resolveConflicts(clientState, serverState, conflicts);
      expect(result.data).toEqual(clientState.data);
    });

    it('should use server state for server resolution', () => {
      const conflicts: StateConflict[] = [{
        clientVersion: 1,
        serverVersion: 2,
        conflictType: 'merge',
        resolution: 'server'
      }];

      const result = manager.resolveConflicts(clientState, serverState, conflicts);
      expect(result.data).toEqual(serverState.data);
    });

    it('should merge states correctly', () => {
      const conflicts: StateConflict[] = [{
        clientVersion: 1,
        serverVersion: 2,
        conflictType: 'merge',
        resolution: 'merge'
      }];

      clientState.changes = [{
        id: '3',
        type: 'update',
        path: ['nested', 'field'],
        value: 'merged',
        timestamp: 1200, // Later than any server change
        source: 'client'
      }];

      const result = manager.resolveConflicts(clientState, serverState, conflicts);
      
      // Should have server's value
      expect(result.data.value).toBe(2);
      
      // Should have client's newer nested field change
      expect(result.data.nested.field).toBe('merged');
    });
  });
});
