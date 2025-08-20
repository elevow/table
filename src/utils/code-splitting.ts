import { PrefetchKind } from 'next/dist/client/components/router-reducer/router-reducer-types';

/**
 * Configuration interfaces for code splitting
 */
export interface RouteConfig {
  path: string;
  priority: 'high' | 'medium' | 'low';
  prefetch: boolean;
  preload: boolean;
}

export interface ComponentConfig {
  name: string;
  chunkName: string;
  prefetch: boolean;
  lazyLoadingThreshold: number; // viewport distance in px to trigger loading
}

export interface ChunkConfig {
  name: string;
  priority: number;
  prefetch: boolean;
  dependencies: string[];
}

export interface PrefetchRule {
  route: string;
  components: string[];
  condition: 'always' | 'viewport' | 'user-interaction';
  viewportThreshold?: number;
}

export interface CodeSplitConfig {
  routes: RouteConfig[];
  components: ComponentConfig[];
  chunks: ChunkConfig[];
  prefetch: PrefetchRule[];
}

/**
 * Default configuration for code splitting
 */
export const defaultCodeSplitConfig: CodeSplitConfig = {
  routes: [
    { path: '/', priority: 'high', prefetch: true, preload: true },
    { path: '/game/:id', priority: 'high', prefetch: true, preload: true },
    { path: '/profile', priority: 'medium', prefetch: true, preload: false },
    { path: '/leaderboard', priority: 'low', prefetch: false, preload: false },
    { path: '/settings', priority: 'low', prefetch: false, preload: false },
  ],
  components: [
    { name: 'GameBoard', chunkName: 'game-core', prefetch: true, lazyLoadingThreshold: 0 },
    { name: 'ChatPanel', chunkName: 'social', prefetch: true, lazyLoadingThreshold: 300 },
    { name: 'PlayerStats', chunkName: 'game-stats', prefetch: true, lazyLoadingThreshold: 100 },
    { name: 'GameSettings', chunkName: 'settings', prefetch: false, lazyLoadingThreshold: 500 },
    { name: 'TournamentBracket', chunkName: 'tournament', prefetch: false, lazyLoadingThreshold: 800 },
  ],
  chunks: [
    { name: 'game-core', priority: 1, prefetch: true, dependencies: [] },
    { name: 'social', priority: 2, prefetch: true, dependencies: [] },
    { name: 'game-stats', priority: 2, prefetch: true, dependencies: ['game-core'] },
    { name: 'settings', priority: 3, prefetch: false, dependencies: [] },
    { name: 'tournament', priority: 4, prefetch: false, dependencies: ['game-core', 'game-stats'] },
  ],
  prefetch: [
    { route: '/', components: ['GameBoard', 'ChatPanel'], condition: 'always', viewportThreshold: 0 },
    { route: '/game/:id', components: ['GameBoard', 'PlayerStats'], condition: 'always', viewportThreshold: 0 },
    { route: '/profile', components: ['PlayerStats'], condition: 'viewport', viewportThreshold: 300 },
    { route: '/settings', components: ['GameSettings'], condition: 'user-interaction', viewportThreshold: 0 },
  ]
};

/**
 * Dynamic import utility with retry mechanism
 */
export const dynamicImport = async <T>(
  importFn: () => Promise<T>, 
  retries = 3, 
  delay = 1000
): Promise<T> => {
  try {
    return await importFn();
  } catch (error) {
    if (retries <= 0) throw error;
    
    console.warn(`Dynamic import failed, retrying... (${retries} attempts left)`);
    await new Promise(resolve => setTimeout(resolve, delay));
    return dynamicImport(importFn, retries - 1, delay * 1.5);
  }
};

/**
 * Intelligent prefetcher based on user behavior
 */
export class IntelligentPrefetcher {
  private prefetchedModules = new Set<string>();
  private userInteractionPatterns: Record<string, number> = {};
  private viewportObserver: IntersectionObserver | null = null;
  
  constructor(private config: CodeSplitConfig) {
    this.initViewportObserver();
    this.trackUserInteractions();
  }
  
  private initViewportObserver() {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return;
    
    this.viewportObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const componentName = entry.target.getAttribute('data-component');
            if (componentName) {
              this.prefetchComponent(componentName);
            }
          }
        });
      },
      { threshold: 0.1, rootMargin: '200px' }
    );
  }
  
  private trackUserInteractions() {
    if (typeof window === 'undefined') return;
    
    window.addEventListener('click', this.handleUserInteraction);
    window.addEventListener('mouseover', this.handleUserInteraction);
  }
  
  private handleUserInteraction = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const route = target.getAttribute('data-route');
    
    if (route) {
      const rules = this.config.prefetch.filter(
        rule => rule.condition === 'user-interaction' && rule.route === route
      );
      
      rules.forEach(rule => {
        rule.components.forEach(comp => this.prefetchComponent(comp));
      });
      
      // Update interaction patterns
      this.userInteractionPatterns[route] = (this.userInteractionPatterns[route] || 0) + 1;
      
      // If user frequently interacts with this route, upgrade its prefetch priority
      if (this.userInteractionPatterns[route] > 3) {
        const routeConfig = this.config.routes.find(r => r.path === route);
        if (routeConfig && routeConfig.priority === 'low') {
          routeConfig.priority = 'medium';
          routeConfig.prefetch = true;
        }
      }
    }
  }
  
  public prefetchComponent(componentName: string) {
    if (this.prefetchedModules.has(componentName)) return;
    
    const component = this.config.components.find(c => c.name === componentName);
    if (!component) return;
    
    const chunk = this.config.chunks.find(c => c.name === component.chunkName);
    if (!chunk || !chunk.prefetch) return;
    
    // Prefetch dependencies first
    if (chunk.dependencies.length > 0) {
      chunk.dependencies.forEach(dep => {
        const depComponent = this.config.components.find(c => c.chunkName === dep);
        if (depComponent) {
          this.prefetchComponent(depComponent.name);
        }
      });
    }
    
    // Mark as prefetched
    this.prefetchedModules.add(componentName);
    console.log(`Prefetching component: ${componentName}`);
    
    // In a real implementation, you would use Next.js router.prefetch here
    // or dynamic imports with prefetch depending on your setup
  }
  
  public observeComponent(element: HTMLElement, componentName: string) {
    if (!this.viewportObserver) return;
    element.setAttribute('data-component', componentName);
    this.viewportObserver.observe(element);
  }
  
  public cleanup() {
    if (typeof window === 'undefined') return;
    
    window.removeEventListener('click', this.handleUserInteraction);
    window.removeEventListener('mouseover', this.handleUserInteraction);
    
    if (this.viewportObserver) {
      this.viewportObserver.disconnect();
    }
  }
}

// Singleton instance
let prefetcherInstance: IntelligentPrefetcher | null = null;

export const getPrefetcher = (): IntelligentPrefetcher => {
  if (!prefetcherInstance) {
    prefetcherInstance = new IntelligentPrefetcher(defaultCodeSplitConfig);
  }
  return prefetcherInstance;
};
