// Configure test environment
beforeAll(() => {
  // Mock timers
  jest.useFakeTimers();
});

afterAll(() => {
  // Cleanup timers
  jest.useRealTimers();
});

// Handle unhandled rejections
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});
