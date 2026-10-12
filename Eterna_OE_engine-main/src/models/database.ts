import { Pool, PoolClient } from 'pg';
import { logger } from '../utils/logger';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    let connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }

    // Parse connection string to extract components and handle SSL
    let config: any = {
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 30000, // Increased to 30s for Cloud SQL connections
    };

    // Database connection modes:
    // 1. Local PostgreSQL: Use standard postgresql://user:pass@localhost:5432/dbname format
    //    - No special parsing needed, works out of the box
    // 2. Cloud SQL (Unix socket): postgresql://user:pass@/database?host=/cloudsql/PROJECT_ID:REGION:INSTANCE_NAME
    //    - Detected by checking for '/cloudsql/' in connection string
    // 3. Cloud SQL (Proxy): postgresql://user:pass@127.0.0.1:5432/database
    //    - Detected by checking for '127.0.0.1:5432' in connection string
    // 4. Supabase: Requires special handling for passwords with special characters and SSL
    //    - Automatically detected by checking for 'supabase.com' in connection string
    if (connectionString.includes('host=/cloudsql/')) {
      // Cloud SQL Unix socket: postgresql://user:pass@/database?host=/cloudsql/PROJECT:REGION:INSTANCE
      const match = connectionString.match(/^postgresql:\/\/([^:]+):([^@]+)@\/([^?]+)\?host=(.+)$/);
      if (match) {
        const [, user, password, database, hostPath] = match;
        config.user = user;
        // decodeURIComponent handles both encoded and unencoded passwords (safe to use on both)
        config.password = decodeURIComponent(password);
        config.database = database || 'postgres';
        config.host = hostPath; // Socket path: /cloudsql/PROJECT:REGION:INSTANCE
        // Don't set port for Unix sockets - the socket path IS the connection mechanism
        // The pg library will automatically look for .s.PGSQL.5432 in this directory
        config.ssl = false;
        logger.info('Cloud SQL Unix socket', { 
          host: config.host, 
          database: config.database,
          user: config.user,
          socketPath: `${config.host}/.s.PGSQL.5432`
        });
      }
    } else if (connectionString.includes('127.0.0.1:5432') || connectionString.includes('localhost:5432')) {
      // Cloud SQL Proxy connection (via localhost)
      try {
        const url = new URL(connectionString);
        config.host = url.hostname;
        config.port = parseInt(url.port || '5432', 10);
        config.database = url.pathname.substring(1) || 'postgres';
        config.user = url.username;
        config.password = decodeURIComponent(url.password || '');
        
        // Cloud SQL Proxy uses localhost, no SSL needed
        config.ssl = false;
        logger.info('Using Cloud SQL Proxy connection', { host: config.host, database: config.database });
      } catch (error) {
        logger.warn('Failed to parse Cloud SQL Proxy connection string, using as-is', { error });
        config.connectionString = connectionString;
        config.ssl = false;
      }
    } else if (connectionString.includes('supabase.com')) {
      try {
        // Parse connection string manually to handle passwords with @ symbol
        // Format: postgresql://user:password@host:port/database?query
        // Find the last @ before the first / (which separates credentials from host)
        const protocolEnd = connectionString.indexOf('://') + 3;
        const firstSlash = connectionString.indexOf('/', protocolEnd);
        
        if (firstSlash === -1) {
          throw new Error('Invalid connection string format: missing database path');
        }
        
        const credentialsAndHost = connectionString.substring(protocolEnd, firstSlash);
        
        // Find the last @ in credentialsAndHost (password may contain @)
        const lastAt = credentialsAndHost.lastIndexOf('@');
        if (lastAt > 0) {
          const credentials = credentialsAndHost.substring(0, lastAt);
          const hostPort = credentialsAndHost.substring(lastAt + 1);
          const colonIndex = credentials.indexOf(':');
          
          if (colonIndex > 0) {
            const user = credentials.substring(0, colonIndex);
            let password = credentials.substring(colonIndex + 1);
            // Decode password if it's URL-encoded (handles both encoded and raw passwords)
            try {
              // Try to decode - if it fails, use as-is (already raw)
              const decoded = decodeURIComponent(password);
              // Only use decoded if it's different (was actually encoded)
              if (decoded !== password || password.includes('%')) {
                password = decoded;
              }
            } catch {
              // If decoding fails, password is already raw, use as-is
            }
            const rest = connectionString.substring(firstSlash);
            
            // Parse host and port
            const [host, portStr] = hostPort.split(':');
            const port = portStr ? parseInt(portStr, 10) : 5432;
            
            // Parse database and query string
            const dbAndQuery = rest.startsWith('/') ? rest.substring(1) : rest;
            const [database, queryStr] = dbAndQuery.split('?');
            
            // Set connection parameters directly (more reliable than connection string)
            config.host = host;
            config.port = port;
            config.database = database || 'postgres';
            config.user = user;
            config.password = password; // Use raw password, pg library handles encoding
            
            // Extract SSL mode from query string
            if (queryStr) {
              const queryParams = new URLSearchParams(queryStr);
              const sslmode = queryParams.get('sslmode') || 'disable';
              if (sslmode === 'disable') {
                config.ssl = false; // Disable SSL completely
              } else if (sslmode === 'no-verify') {
                config.ssl = { rejectUnauthorized: false }; // SSL but don't verify cert
              } else {
                config.ssl = { rejectUnauthorized: true }; // SSL with cert verification
              }
            } else {
              config.ssl = false; // Default: disable SSL for Supabase
            }
            
            // Don't use connectionString when we have individual params
            // (connectionString is not set, so Pool will use individual params)
          } else {
            throw new Error('Invalid connection string format: missing password');
          }
        } else {
          throw new Error('Invalid connection string format: missing @ separator');
        }
      } catch (error) {
        logger.warn('Failed to parse connection string, using as-is', { error });
        // Fallback: use connection string as-is and disable SSL
        config.ssl = false;
      }
    }

    // Use connectionString if we didn't parse it into individual params
    if (!config.host) {
      config.connectionString = connectionString;
    }
    
    pool = new Pool(config);

    pool.on('error', (err) => {
      logger.error('Unexpected error on idle client', { error: err });
    });
  }

  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
