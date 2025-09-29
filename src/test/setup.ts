// Configure test environment
beforeAll(() => {
  // Note: Fake timers removed from global setup as they were causing test hangs
  // Individual tests that need fake timers should use jest.useFakeTimers() locally
});

// Handle unhandled rejections
process.on('unhandledRejection', (error) => {
  // Only log in non-CI environments
  if (!process.env.CI) {
    console.error('Unhandled rejection:', error);
  }
});
