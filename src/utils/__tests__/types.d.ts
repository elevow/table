// Add TypeScript declarations for Jest globals
declare global {
  namespace NodeJS {
    interface Global {
      navigator: any;
      window: any;
      caches: any;
    }
  }
}

export {};
