// Test setup file
// This file runs before all tests

// Set default test environment
// Tests can override this by setting DEVNET_ENABLED in their test files
if (process.env.DEVNET_ENABLED === undefined) {
  // Default to mock providers for tests unless explicitly set
  process.env.DEVNET_ENABLED = 'false';
}

// Export original env var for reference
export const originalDevnetEnabled = process.env.DEVNET_ENABLED;
