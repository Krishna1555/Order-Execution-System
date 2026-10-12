# Environment Setup

This guide covers setting up the development environment on Windows using Memurai (Redis) and either local PostgreSQL or Supabase (PostgreSQL).

## Prerequisites

- Node.js 18+ installed
- Memurai installed and running (Windows Redis alternative)
- PostgreSQL database (choose one):
  - **Local PostgreSQL** (recommended for testing) - Install PostgreSQL locally
  - **Supabase** (cloud PostgreSQL) - Create a Supabase account and project

## Database Options

### Option A: Local PostgreSQL (Recommended for Testing)

Use local PostgreSQL for faster development and testing. This setup is not pushed to GitHub.

**Install PostgreSQL:**
1. Download PostgreSQL from [postgresql.org](https://www.postgresql.org/download/windows/)
2. Install PostgreSQL (remember the password you set for the `postgres` user)
3. PostgreSQL runs on `localhost:5432` by default

**Create Database:**
```sql
-- Connect to PostgreSQL (using psql or pgAdmin)
CREATE DATABASE eterna_order_engine;
```

**Connection String Format:**
```
postgresql://postgres:your_password@localhost:5432/eterna_order_engine
```

### Option B: Supabase (Cloud PostgreSQL)

Use Supabase for cloud-hosted PostgreSQL. Good for production or when you don't want to install PostgreSQL locally.

**Set Up Supabase:**
1. Go to [supabase.com](https://supabase.com/) and sign up/login
2. Create a new project
3. Wait for the project to be provisioned (takes a few minutes)
4. Go to Project Settings → Database
5. Copy the connection string (use the "Connection pooling" option for better performance)
   - Format: `postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres`
   - Or use the direct connection: `postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres`

## Step 1: Install Memurai

1. Download Memurai from [memurai.com](https://www.memurai.com/)
2. Install Memurai (follow the installation wizard)
3. Memurai will run as a Windows service on port 6379 by default
4. Verify it's running:
   ```powershell
   # Check if Memurai service is running
   Get-Service -Name Memurai* | Select-Object Name, Status
   ```

## Step 2: Create Environment File

Create a `.env` file in the root directory with the following variables:

```env
# Server Configuration
NODE_ENV=development
PORT=3000
LOG_LEVEL=info

# Database Configuration
# Choose ONE of the following options:

# Option A: Local PostgreSQL (for testing)
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/eterna_order_engine

# Option B: Supabase (cloud PostgreSQL)
# DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?sslmode=disable

# Redis Configuration (Memurai)
REDIS_URL=redis://localhost:6379

# Queue Configuration
QUEUE_CONCURRENCY=10
QUEUE_RATE_LIMIT=100

# DEX Configuration (for mock)
MOCK_DEX_DELAY_MIN=200
MOCK_DEX_DELAY_MAX=300
MOCK_EXECUTION_DELAY_MIN=2000
MOCK_EXECUTION_DELAY_MAX=3000

# Solana Configuration (for real devnet execution)
# Note: Users provide their own wallets in order requests - no service wallet needed
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_CLUSTER=devnet
DEVNET_ENABLED=false  # Set to 'true' to use real DEX providers instead of mocks
```

### Database Connection Details

**Local PostgreSQL:**
- Simple connection string format: `postgresql://user:password@host:port/database`
- No SSL required
- Fast and reliable for local development
- Example: `postgresql://postgres:mypassword@localhost:5432/eterna_order_engine`

**Supabase Connection String Details:**

- **Pooler connection** (recommended): Port `6543` - Better for serverless/connection pooling
- **Direct connection**: Port `5432` - Direct PostgreSQL connection
- **SSL**: Supabase requires SSL. Add `?sslmode=require` if not included in the connection string
- **Example with SSL**: `postgresql://postgres.[ref]:[pass]@aws-0-[region].pooler.supabase.com:6543/postgres?sslmode=require`

## Step 3: Run Database Migrations

After setting up your `.env` file with the Supabase connection string:

```bash
npm run db:migrate
```

This will create the `orders` table in your Supabase database.

## Step 4: Verify Setup

1. **Verify Memurai is running:**
   ```powershell
   # Test Redis connection
   redis-cli ping
   # Should return: PONG
   ```

2. **Verify Supabase connection:**
   ```bash
   # The migration command will verify the connection
   npm run db:migrate
   ```

## Production Environment Variables

For production, ensure all variables are set appropriately:

- `NODE_ENV=production`
- `DATABASE_URL` - Your production Supabase connection string
- `REDIS_URL` - Your production Redis connection string (or Memurai if on Windows)
- `LOG_LEVEL=info` or `warn` for production

## Troubleshooting

### Memurai Connection Issues

- **Service not running**: Start Memurai service from Windows Services
- **Port 6379 in use**: Check if another Redis instance is running
- **Connection refused**: Verify Memurai is listening on port 6379

### Local PostgreSQL Connection Issues

- **Connection refused**: Ensure PostgreSQL service is running
- **Authentication failed**: Verify username and password in connection string
- **Database does not exist**: Create the database first: `CREATE DATABASE eterna_order_engine;`
- **Port 5432 in use**: Check if PostgreSQL is running on a different port

### Supabase Connection Issues

- **SSL required**: Add `?sslmode=disable` or `?sslmode=require` to your connection string
- **Connection timeout**: Check firewall settings, Supabase allows connections from anywhere by default
- **Authentication failed**: Verify your password is correct in the connection string
- **Database not found**: Ensure you're using the correct database name (usually `postgres`)

### Solana/Devnet Configuration Issues

- **DEVNET_ENABLED**: Set to `true` to use real Raydium/Meteora SDKs (requires user wallets)
- **SOLANA_RPC_URL**: Defaults to devnet. Use custom RPC for better performance/rate limits
- **SOLANA_CLUSTER**: Set to `devnet` or `mainnet-beta` (Raydium SDK uses `mainnet` not `mainnet-beta`)
- **User Wallets**: Users must provide their own wallet (`walletPrivateKey` or `walletKeypair`) in order requests
  - No service wallet configuration needed - each order uses the user's wallet
  - For devnet testing, use Solana faucet: https://faucet.solana.com

### General Issues

- **Environment variables not loading**: Ensure `.env` file is in the root directory
- **Migration fails**: Check that your Supabase project is fully provisioned
- **Connection pool exhausted**: Use Supabase connection pooler (port 6543) instead of direct connection
- **Wallet format errors**: Ensure wallet is base58-encoded (64 bytes) for `walletPrivateKey`, or JSON array of 64 numbers for `walletKeypair`

## Testing with DEVNET_ENABLED

### Running Tests with Mock Providers (Default)

By default, tests use mock providers (no Solana network connection required):

```bash
# All tests with mock providers
npm test

# Specific test suites
npm run test:unit
npm run test:integration
npm run test:coverage
```

### Running Tests with Real Devnet Providers

To test with real Raydium/Meteora SDKs (requires Solana network connection):

**Windows PowerShell:**
```powershell
$env:DEVNET_ENABLED="true"
npm test
```

**Windows CMD:**
```cmd
set DEVNET_ENABLED=true && npm test
```

**Or use the npm script:**
```bash
npm run test:devnet           # All tests
npm run test:devnet:unit      # Unit tests only
npm run test:devnet:integration  # Integration tests only
```

### Test Behavior with DEVNET_ENABLED

When `DEVNET_ENABLED=true`:

- **`getQuote()` tests**: Will pass (real providers have placeholder implementations that return mock-like data)
- **`executeSwap()` tests**: Will fail with "not yet fully implemented" errors (expected until full SDK integration is complete)

This is expected behavior. The real providers (`RaydiumProvider`, `MeteoraProvider`) currently have:
- ✅ Working placeholder implementations for `getQuote()` (returns mock-like data)
- ⚠️ Placeholder implementations for `executeSwap()` that throw "not yet fully implemented" errors

The tests verify that:
1. The router correctly switches to real providers based on `DEVNET_ENABLED`
2. `getQuote()` works with both mock and real providers
3. `executeSwap()` properly handles the "not yet implemented" state (expected until full SDK integration)

### Note on Full SDK Integration

Once the Raydium and Meteora SDK APIs are fully integrated and `executeSwap()` is implemented, the tests will work completely with `DEVNET_ENABLED=true`. Until then, the placeholder implementations ensure the architecture is correct while allowing incremental development.