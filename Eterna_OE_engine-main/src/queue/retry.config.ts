export const retryConfig = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 2000, // Initial delay in ms
  },
};
