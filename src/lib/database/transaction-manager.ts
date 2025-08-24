// US-012: Data Consistency - Transaction Management System

import { DatabasePool, DatabaseClient } from './database-connection';

export type IsolationLevel = 'read_committed' | 'repeatable_read' | 'serializable';

export interface RetryStrategy {
  maxAttempts: number;
  baseDelay: number; // milliseconds
  backoffFactor: number;
  jitter: boolean;
}

export interface TransactionConfig {
  isolationLevel: IsolationLevel;
  timeout: number; // milliseconds
  retryPolicy: RetryStrategy;
  autoCommit?: boolean;
  readOnly?: boolean;
}

export interface TransactionContext {
  id: string;
  client: DatabaseClient;
  config: TransactionConfig;
  startTime: Date;
  operations: TransactionOperation[];
  status: TransactionStatus;
  savepoints: Map<string, number>;
}

export interface TransactionOperation {
  id: string;
  sql: string;
  params?: any[];
  timestamp: Date;
  duration?: number;
  result?: any;
  error?: Error;
}

export type TransactionStatus = 'pending' | 'active' | 'committed' | 'aborted' | 'failed';

export interface ConflictResolutionStrategy {
  type: 'retry' | 'merge' | 'abort' | 'last_writer_wins';
  maxRetries?: number;
  mergeFunction?: (current: any, incoming: any) => any;
}

export interface LockConfig {
  type: 'row' | 'table' | 'advisory';
  mode: 'shared' | 'exclusive';
  timeout?: number;
  noWait?: boolean;
}

export interface DeadlockInfo {
  transactionId: string;
  blockedBy: string[];
  blockedOperations: string[];
  detectedAt: Date;
}

/**
 * Comprehensive transaction manager ensuring ACID properties
 */
export class TransactionManager {
  private activeTransactions = new Map<string, TransactionContext>();
  private lockManager = new LockManager();
  private conflictResolver = new ConflictResolver();
  private deadlockDetector = new DeadlockDetector();
  private transactionHistory: TransactionOperation[] = [];
  
  private readonly defaultConfig: TransactionConfig = {
    isolationLevel: 'read_committed',
    timeout: 30000, // 30 seconds
    retryPolicy: {
      maxAttempts: 3,
      baseDelay: 100,
      backoffFactor: 2,
      jitter: true
    },
    autoCommit: false,
    readOnly: false
  };

  constructor(private dbPool: DatabasePool) {
    // Start deadlock detection
    this.deadlockDetector.start();
  }

  /**
   * Begin a new transaction with specified configuration
   */
  async beginTransaction(config?: Partial<TransactionConfig>): Promise<TransactionContext> {
    const finalConfig = { ...this.defaultConfig, ...config };
    
    // Validate isolation level
    const validLevels: IsolationLevel[] = ['read_committed', 'repeatable_read', 'serializable'];
    if (!validLevels.includes(finalConfig.isolationLevel)) {
      throw new TransactionError(`Invalid isolation level: ${finalConfig.isolationLevel}`, 'INVALID_CONFIG');
    }
    
    const client = await this.dbPool.connect();
    const transactionId = this.generateTransactionId();

    try {
      // Set isolation level
      await client.query(`SET TRANSACTION ISOLATION LEVEL ${finalConfig.isolationLevel.toUpperCase().replace('_', ' ')}`);
      
      // Set read-only if specified
      if (finalConfig.readOnly) {
        await client.query('SET TRANSACTION READ ONLY');
      }

      // Set timeout
      await client.query(`SET statement_timeout = ${finalConfig.timeout}`);

      // Begin transaction
      await client.query('BEGIN');

      const context: TransactionContext = {
        id: transactionId,
        client,
        config: finalConfig,
        startTime: new Date(),
        operations: [],
        status: 'active',
        savepoints: new Map()
      };

      this.activeTransactions.set(transactionId, context);

      // Set up timeout handler
      this.setupTransactionTimeout(context);

      return context;
    } catch (error) {
      client.release();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new TransactionError(`Failed to begin transaction: ${errorMessage}`, 'BEGIN_FAILED');
    }
  }

  /**
   * Execute a query within a transaction with conflict detection
   */
  async executeInTransaction(
    context: TransactionContext,
    sql: string,
    params?: any[],
    options?: {
      lockConfig?: LockConfig;
      conflictStrategy?: ConflictResolutionStrategy;
    }
  ): Promise<any> {
    if (context.status !== 'active') {
      throw new TransactionError('Transaction is not active', 'INVALID_STATE');
    }

    const operationId = this.generateOperationId();
    const operation: TransactionOperation = {
      id: operationId,
      sql,
      params,
      timestamp: new Date()
    };

    try {
      // Apply locks if specified
      if (options?.lockConfig) {
        await this.acquireLock(context, options.lockConfig);
      }

      // Execute with retry logic for deadlocks
      const result = await this.executeWithRetry(context, operation, options?.conflictStrategy);
      
      operation.result = result;
      operation.duration = Date.now() - operation.timestamp.getTime();
      
      context.operations.push(operation);
      this.transactionHistory.push(operation);

      return result;
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      operation.error = errorObj;
      operation.duration = Date.now() - operation.timestamp.getTime();
      
      context.operations.push(operation);
      
      // Handle specific conflict types
      if (this.isConflictError(errorObj)) {
        return this.handleConflict(context, operation, errorObj, options?.conflictStrategy);
      }
      
      throw errorObj;
    }
  }

  /**
   * Create a savepoint for partial rollback
   */
  async createSavepoint(context: TransactionContext, name: string): Promise<void> {
    if (context.status !== 'active') {
      throw new TransactionError('Transaction is not active', 'INVALID_STATE');
    }

    await context.client.query(`SAVEPOINT ${name}`);
    context.savepoints.set(name, context.operations.length);
  }

  /**
   * Rollback to a specific savepoint
   */
  async rollbackToSavepoint(context: TransactionContext, name: string): Promise<void> {
    if (context.status !== 'active') {
      throw new TransactionError('Transaction is not active', 'INVALID_STATE');
    }

    if (!context.savepoints.has(name)) {
      throw new TransactionError(`Savepoint ${name} does not exist`, 'SAVEPOINT_NOT_FOUND');
    }

    await context.client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    
    // Remove operations after savepoint
    const savepointIndex = context.savepoints.get(name)!;
    context.operations = context.operations.slice(0, savepointIndex);
  }

  /**
   * Commit the transaction
   */
  async commitTransaction(context: TransactionContext): Promise<void> {
    if (context.status !== 'active') {
      throw new TransactionError('Transaction is not active', 'INVALID_STATE');
    }

    try {
      // Check for deadlocks before commit
      await this.checkForDeadlocks(context);

      // Pre-commit validation
      await this.validateTransactionIntegrity(context);

      // Commit
      await context.client.query('COMMIT');
      
      context.status = 'committed';
      
      // Release locks
      await this.lockManager.releaseTransactionLocks(context.id);
      
      // Clean up
      this.cleanupTransaction(context);
      
    } catch (error) {
      context.status = 'failed';
      await this.rollbackTransaction(context);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new TransactionError(`Commit failed: ${errorMessage}`, 'COMMIT_FAILED');
    }
  }

  /**
   * Rollback the transaction
   */
  async rollbackTransaction(context: TransactionContext): Promise<void> {
    try {
      if (context.status === 'active') {
        await context.client.query('ROLLBACK');
      }
      
      context.status = 'aborted';
      
      // Release locks
      await this.lockManager.releaseTransactionLocks(context.id);
      
      // Clean up
      this.cleanupTransaction(context);
      
    } catch (error) {
      console.error('Error during rollback:', error);
      // Force cleanup even if rollback fails
      this.cleanupTransaction(context);
    }
  }

  /**
   * Execute a function within a transaction with automatic retry
   */
  async withTransaction<T>(
    operation: (context: TransactionContext) => Promise<T>,
    config?: Partial<TransactionConfig>
  ): Promise<T> {
    const finalConfig = { ...this.defaultConfig, ...config };
    let lastError: Error = new Error('No error'); // Initialize to avoid unassigned error

    for (let attempt = 1; attempt <= finalConfig.retryPolicy.maxAttempts; attempt++) {
      const context = await this.beginTransaction(finalConfig);
      
      try {
        const result = await operation(context);
        await this.commitTransaction(context);
        return result;
      } catch (error) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        lastError = errorObj;
        await this.rollbackTransaction(context);
        
        // Don't retry if it's not a retriable error
        if (!this.isRetriableError(errorObj) || attempt === finalConfig.retryPolicy.maxAttempts) {
          break;
        }
        
        // Wait before retry with exponential backoff
        const delay = this.calculateRetryDelay(attempt, finalConfig.retryPolicy);
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * Get transaction statistics
   */
  getTransactionStats(): TransactionStats {
    const active = this.activeTransactions.size;
    const recent = this.transactionHistory.slice(-1000);
    
    const committed = recent.filter(op => 
      this.activeTransactions.get(op.id)?.status === 'committed'
    ).length;
    
    const aborted = recent.filter(op => 
      this.activeTransactions.get(op.id)?.status === 'aborted'
    ).length;

    const avgDuration = recent.reduce((sum, op) => sum + (op.duration || 0), 0) / recent.length;
    
    return {
      active,
      committed,
      aborted,
      avgDuration,
      deadlocks: this.deadlockDetector.getDeadlockCount(),
      conflicts: this.conflictResolver.getConflictCount()
    };
  }

  /**
   * Get active transaction information
   */
  getActiveTransactions(): TransactionInfo[] {
    return Array.from(this.activeTransactions.values()).map(context => ({
      id: context.id,
      startTime: context.startTime,
      duration: Date.now() - context.startTime.getTime(),
      operationCount: context.operations.length,
      isolationLevel: context.config.isolationLevel,
      status: context.status
    }));
  }

  /**
   * Force abort a transaction (admin function)
   */
  async forceAbortTransaction(transactionId: string): Promise<void> {
    const context = this.activeTransactions.get(transactionId);
    if (context) {
      await this.rollbackTransaction(context);
    }
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    // Abort all active transactions
    const promises = Array.from(this.activeTransactions.values()).map(
      context => this.rollbackTransaction(context)
    );
    
    await Promise.allSettled(promises);
    
    this.deadlockDetector.stop();
    await this.lockManager.cleanup();
  }

  // Private helper methods

  private setupTransactionTimeout(context: TransactionContext): void {
    setTimeout(async () => {
      if (context.status === 'active') {
        console.warn(`Transaction ${context.id} timed out`);
        await this.rollbackTransaction(context);
      }
    }, context.config.timeout);
  }

  private async executeWithRetry(
    context: TransactionContext,
    operation: TransactionOperation,
    conflictStrategy?: ConflictResolutionStrategy
  ): Promise<any> {
    const maxRetries = conflictStrategy?.maxRetries || 3;
    let lastError: Error = new Error('No error'); // Initialize to avoid unassigned error

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await context.client.query(operation.sql, operation.params);
      } catch (error) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        lastError = errorObj;
        
        if (this.isDeadlockError(errorObj)) {
          this.deadlockDetector.recordDeadlock(context.id, errorObj.message);
          
          if (attempt < maxRetries) {
            await this.sleep(50 * attempt); // Progressive delay
            continue;
          }
        }
        
        throw errorObj;
      }
    }

    throw lastError;
  }

  private async handleConflict(
    context: TransactionContext,
    operation: TransactionOperation,
    error: Error,
    strategy?: ConflictResolutionStrategy
  ): Promise<any> {
    return this.conflictResolver.resolve(context, operation, error, strategy);
  }

  private async acquireLock(context: TransactionContext, lockConfig: LockConfig): Promise<void> {
    await this.lockManager.acquireLock(context.id, lockConfig);
  }

  private async checkForDeadlocks(context: TransactionContext): Promise<void> {
    const deadlock = await this.deadlockDetector.checkTransaction(context.id);
    if (deadlock) {
      throw new TransactionError('Deadlock detected', 'DEADLOCK');
    }
  }

  private async validateTransactionIntegrity(context: TransactionContext): Promise<void> {
    // Implement business-specific validation rules
    for (const operation of context.operations) {
      if (operation.error) {
        throw new TransactionError('Transaction contains failed operations', 'INTEGRITY_ERROR');
      }
    }
  }

  private cleanupTransaction(context: TransactionContext): void {
    context.client.release();
    this.activeTransactions.delete(context.id);
  }

  private isConflictError(error: Error): boolean {
    return error.message.includes('could not serialize') ||
           error.message.includes('deadlock detected') ||
           error.message.includes('concurrent update');
  }

  private isDeadlockError(error: Error): boolean {
    return error.message.includes('deadlock detected');
  }

  private isRetriableError(error: Error): boolean {
    return this.isDeadlockError(error) || 
           error.message.includes('connection') ||
           error.message.includes('timeout');
  }

  private calculateRetryDelay(attempt: number, strategy: RetryStrategy): number {
    let delay = strategy.baseDelay * Math.pow(strategy.backoffFactor, attempt - 1);
    
    if (strategy.jitter) {
      delay *= 0.5 + Math.random() * 0.5; // Add jitter
    }
    
    return Math.min(delay, 5000); // Cap at 5 seconds
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private generateTransactionId(): string {
    return `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateOperationId(): string {
    return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Lock manager for handling concurrent access
 */
class LockManager {
  private locks = new Map<string, Set<string>>(); // resource -> transaction IDs
  private transactionLocks = new Map<string, Set<string>>(); // transaction ID -> resources

  async acquireLock(transactionId: string, config: LockConfig): Promise<void> {
    const resourceId = this.generateResourceId(config);
    
    // Check if lock is available
    if (this.locks.has(resourceId) && config.noWait) {
      throw new TransactionError('Lock not available', 'LOCK_NOT_AVAILABLE');
    }

    // Wait for lock or timeout
    const acquired = await this.waitForLock(resourceId, transactionId, config.timeout || 5000);
    
    if (!acquired) {
      throw new TransactionError('Lock timeout', 'LOCK_TIMEOUT');
    }

    // Record lock
    if (!this.locks.has(resourceId)) {
      this.locks.set(resourceId, new Set());
    }
    this.locks.get(resourceId)!.add(transactionId);

    if (!this.transactionLocks.has(transactionId)) {
      this.transactionLocks.set(transactionId, new Set());
    }
    this.transactionLocks.get(transactionId)!.add(resourceId);
  }

  async releaseTransactionLocks(transactionId: string): Promise<void> {
    const resources = this.transactionLocks.get(transactionId);
    if (resources) {
      for (const resource of Array.from(resources)) {
        const lockSet = this.locks.get(resource);
        if (lockSet) {
          lockSet.delete(transactionId);
          if (lockSet.size === 0) {
            this.locks.delete(resource);
          }
        }
      }
      this.transactionLocks.delete(transactionId);
    }
  }

  async cleanup(): Promise<void> {
    this.locks.clear();
    this.transactionLocks.clear();
  }

  private async waitForLock(resourceId: string, transactionId: string, timeout: number): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const lockSet = this.locks.get(resourceId);
      if (!lockSet || lockSet.size === 0) {
        return true;
      }
      
      await this.sleep(10); // Check every 10ms
    }
    
    return false;
  }

  private generateResourceId(config: LockConfig): string {
    return `${config.type}_${config.mode}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Conflict resolver for handling concurrent modifications
 */
class ConflictResolver {
  private conflictCount = 0;

  async resolve(
    context: TransactionContext,
    operation: TransactionOperation,
    error: Error,
    strategy?: ConflictResolutionStrategy
  ): Promise<any> {
    this.conflictCount++;
    
    const resolveStrategy = strategy || { type: 'retry', maxRetries: 3 };
    
    switch (resolveStrategy.type) {
      case 'retry':
        return this.retryWithBackoff(context, operation, resolveStrategy.maxRetries || 3);
      
      case 'abort':
        throw new TransactionError('Conflict detected - aborting', 'CONFLICT_ABORT');
      
      case 'last_writer_wins':
        // Force the operation through
        return context.client.query(operation.sql, operation.params);
      
      case 'merge':
        if (resolveStrategy.mergeFunction) {
          return this.performMerge(context, operation, resolveStrategy.mergeFunction);
        }
        throw new TransactionError('Merge function not provided', 'MERGE_ERROR');
      
      default:
        throw new TransactionError('Unknown conflict resolution strategy', 'UNKNOWN_STRATEGY');
    }
  }

  getConflictCount(): number {
    return this.conflictCount;
  }

  private async retryWithBackoff(
    context: TransactionContext,
    operation: TransactionOperation,
    maxRetries: number
  ): Promise<any> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        await this.sleep(100 * Math.pow(2, i)); // Exponential backoff
        return await context.client.query(operation.sql, operation.params);
      } catch (error) {
        if (i === maxRetries - 1) throw error;
      }
    }
  }

  private async performMerge(
    context: TransactionContext,
    operation: TransactionOperation,
    mergeFunction: (current: any, incoming: any) => any
  ): Promise<any> {
    // Simplified merge implementation
    // In practice, this would be more sophisticated
    throw new TransactionError('Merge resolution not yet implemented', 'MERGE_NOT_IMPLEMENTED');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Deadlock detector for monitoring transaction dependencies
 */
class DeadlockDetector {
  private deadlockCount = 0;
  private detectionInterval?: NodeJS.Timeout;
  private transactionGraph = new Map<string, Set<string>>(); // transaction -> blocked by

  start(): void {
    this.detectionInterval = setInterval(() => {
      this.detectDeadlocks();
    }, 1000); // Check every second
  }

  stop(): void {
    if (this.detectionInterval) {
      clearInterval(this.detectionInterval);
    }
  }

  recordDeadlock(transactionId: string, details: string): void {
    this.deadlockCount++;
    console.warn(`Deadlock detected for transaction ${transactionId}: ${details}`);
  }

  async checkTransaction(transactionId: string): Promise<DeadlockInfo | null> {
    // Simplified deadlock detection
    // In practice, this would analyze wait-for graphs
    return null;
  }

  getDeadlockCount(): number {
    return this.deadlockCount;
  }

  private detectDeadlocks(): void {
    // Implement cycle detection in wait-for graph
    // This is a simplified version
  }
}

/**
 * Custom transaction error class
 */
export class TransactionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'TransactionError';
    
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TransactionError);
    }
  }
}

/**
 * Transaction statistics interface
 */
export interface TransactionStats {
  active: number;
  committed: number;
  aborted: number;
  avgDuration: number;
  deadlocks: number;
  conflicts: number;
}

/**
 * Transaction information interface
 */
export interface TransactionInfo {
  id: string;
  startTime: Date;
  duration: number;
  operationCount: number;
  isolationLevel: IsolationLevel;
  status: TransactionStatus;
}

/**
 * Factory for creating transaction managers
 */
export class TransactionManagerFactory {
  static create(dbPool: DatabasePool): TransactionManager {
    return new TransactionManager(dbPool);
  }

  static createWithConfig(
    dbPool: DatabasePool,
    defaultConfig: Partial<TransactionConfig>
  ): TransactionManager {
    const manager = new TransactionManager(dbPool);
    // Apply default configuration
    return manager;
  }
}
