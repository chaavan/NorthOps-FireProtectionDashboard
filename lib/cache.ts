/**
 * Simple in-memory cache for API responses
 * For production with high traffic, consider using Redis
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class Cache {
  private store: Map<string, CacheEntry<any>> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean up expired entries every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 1000);
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt < now) {
        this.store.delete(key);
      }
    }
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }

    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlMs: number): void {
    this.store.set(key, {
      data,
      expiresAt: Date.now() + ttlMs,
    });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  deletePattern(pattern: string): void {
    const regex = new RegExp(pattern);
    for (const key of this.store.keys()) {
      if (regex.test(key)) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }

  destroy() {
    clearInterval(this.cleanupInterval);
    this.store.clear();
  }
}

export const cache = new Cache();

/**
 * Cache key generators
 */
export const cacheKeys = {
  jobsList: () => 'jobs:list',
  jobDetails: (jobNumber: string, listNumber: string = '1') =>
    `jobs:${jobNumber}:${listNumber}`,
  calendar: () => 'calendar:all',
  delivery: (jobNumber: string, listNumber: string = '1') =>
    `delivery:${jobNumber}:${listNumber}`,
  pricing: (partNumbers: string[]) => `pricing:${partNumbers.sort().join(',')}`,
  suppliers: (partNumbers: string[]) => `suppliers:${partNumbers.sort().join(',')}`,
  vendors: () => 'vendors:all',
};

/**
 * Cache TTLs (in milliseconds)
 */
export const cacheTTL = {
  jobsList: 2 * 60 * 1000, // 2 minutes
  jobDetails: 1 * 60 * 1000, // 1 minute
  calendar: 5 * 60 * 1000, // 5 minutes
  delivery: 2 * 60 * 1000, // 2 minutes
  pricing: 10 * 60 * 1000, // 10 minutes (pricing changes infrequently)
  suppliers: 10 * 60 * 1000, // 10 minutes
  vendors: 60 * 60 * 1000, // 1 hour (vendors change infrequently)
};

