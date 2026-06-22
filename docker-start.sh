#!/bin/bash
set -e

echo "Starting Apache on port 8080..."
apache2ctl start

echo "Starting Node.js server on port 89..."
cd /app
exec node dist/server.js
