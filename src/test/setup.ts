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
  // Only log in non-CI environments
  if (!process.env.CI) {
    console.error('Unhandled rejection:', error);
  }
});
