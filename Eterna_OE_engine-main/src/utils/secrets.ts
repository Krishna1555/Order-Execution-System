// DEPRECATED: Secret Manager utility - now using .env file directly
// This file is kept for backwards compatibility but no longer fetches from Secret Manager
// All secrets should be set in .env file (included in deployment)

import { logger } from './logger';

/**
 * @deprecated This function is deprecated. Use .env file for secrets (included in deployment).
 * Fetch a secret - now just reads from environment variables (loaded from .env file)
 * @param secretName - Name of the secret (e.g., 'database-url')
 * @param _projectId - GCP project ID (unused, kept for backwards compatibility)
 * @returns Secret value as string from environment variable
 */
export async function getSecret(
  secretName: string,
  _projectId?: string
): Promise<string> {
  // Check environment variable (loaded from .env file by dotenv.config())
  const envVarName = secretName.toUpperCase().replace(/-/g, '_');
  const envValue = process.env[envVarName] || process.env[secretName];
  
  if (envValue) {
    logger.debug('Using secret from environment variable (loaded from .env file)', { secretName, envVarName });
    return envValue;
  }

  throw new Error(
    `Secret ${secretName} not found in environment variables. ` +
    `Please set ${envVarName} in .env file (included in deployment).`
  );
}

/**
 * @deprecated This function is deprecated. Environment variables are now loaded from .env file via dotenv.config().
 * Initialize secrets at application startup - now just validates environment variables are set
 */
export async function initializeSecrets(): Promise<void> {
  try {
    logger.info('Secrets validation (using .env file included in deployment)');

    // Validate that required environment variables are set (loaded from .env file)
    if (!process.env.DATABASE_URL) {
      logger.warn('DATABASE_URL environment variable not set. Please set it in .env file (included in deployment).');
    } else {
      logger.info('DATABASE_URL is set from .env file', {
        databaseUrl: process.env.DATABASE_URL.replace(/:[^:@]+@/, ':****@'), // Hide password
      });
    }

    if (!process.env.REDIS_URL) {
      logger.warn('REDIS_URL environment variable not set. Please set it in .env file (included in deployment).');
    } else {
      logger.info('REDIS_URL is set from .env file', {
        redisUrl: process.env.REDIS_URL.replace(/:[^:@]+@/, ':****@'), // Hide password if present
      });
    }

    logger.info('Secrets validation complete (using .env file)');
  } catch (error) {
    logger.error('Error validating secrets', { error });
    // Don't throw - allow app to continue with environment variables
  }
}
