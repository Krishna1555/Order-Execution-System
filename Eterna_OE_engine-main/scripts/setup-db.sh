#!/bin/bash

# Database setup script
echo "Setting up database..."

# Run migrations
npm run db:migrate

echo "Database setup complete!"
