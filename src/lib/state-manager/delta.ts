import { StateDelta } from '../../types/state';
import { IDeltaManager } from './types';

export class DeltaManager implements IDeltaManager {
  public calculateDelta<T>(oldState: T, newState: T): StateDelta {
    const changes = [];
    const paths = this.findChangedPaths(oldState, newState);

    for (const path of paths) {
      changes.push({
        path,
        oldValue: this.getValueAtPath(oldState, path),
        newValue: this.getValueAtPath(newState, path),
        timestamp: Date.now()
      });
    }

    return {
      changes,
      from: 0, // These will be set by the sync manager
      to: 0,
    };
  }

  public applyDelta<T>(state: T, delta: StateDelta): T {
    const newState = { ...state };
    
    for (const change of delta.changes) {
      this.setValueAtPath(newState, change.path, change.newValue);
    }

    return newState;
  }

  public findChangedPaths<T>(oldObj: T, newObj: T, basePath = ''): string[] {
    const paths: string[] = [];
    
    if (oldObj === newObj) return paths;
    if (typeof oldObj !== typeof newObj) {
      paths.push(basePath);
      return paths;
    }

    if (typeof oldObj !== 'object' || typeof newObj !== 'object') {
      if (oldObj !== newObj) paths.push(basePath);
      return paths;
    }

    if (!oldObj || !newObj) {
      paths.push(basePath);
      return paths;
    }

    const allKeys = Array.from(new Set([
      ...Object.keys(oldObj as object),
      ...Object.keys(newObj as object)
    ]));

    for (const key of allKeys) {
      const oldVal = (oldObj as any)[key];
      const newVal = (newObj as any)[key];
      const newPath = basePath ? `${basePath}.${key}` : key;

      if (oldVal === newVal) continue;

      if (typeof oldVal === 'object' && typeof newVal === 'object') {
        paths.push(...this.findChangedPaths(oldVal, newVal, newPath));
      } else {
        paths.push(newPath);
      }
    }

    return paths;
  }

  public getValueAtPath<T>(obj: T, path: string): any {
    if (!path) return obj;

    const parts = path.split('.');
    let current: any = obj;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = current[part];
    }

    return current;
  }

  public setValueAtPath<T>(obj: T, path: string, value: any): void {
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
