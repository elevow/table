// Small environment helpers isolated for easy mocking in tests
export function isBrowser(): boolean {
  return typeof window !== 'undefined';
}
