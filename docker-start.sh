#!/bin/bash
set -e

DB_PATH="/app/data/web-agent.db"

if [ -f "$DB_PATH" ]; then
  BACKUP_DIR="/app/data/backups"
  mkdir -p "$BACKUP_DIR"
  TIMESTAMP=$(date +%Y%m%d_%H%M%S)
  cp "$DB_PATH" "$BACKUP_DIR/web-agent_${TIMESTAMP}.db"
  echo "Database backup created: web-agent_${TIMESTAMP}.db"
  COUNT=$(ls -1 "$BACKUP_DIR"/web-agent_*.db 2>/dev/null | wc -l)
  if [ "$COUNT" -gt 5 ]; then
    ls -1t "$BACKUP_DIR"/web-agent_*.db | tail -n +6 | xargs rm -f
    echo "Rotated old backups, keeping latest 5"
  fi
else
  echo "No existing database found, will create new one"
fi

echo "Starting Apache on port 8080..."
apache2ctl start

echo "Starting Node.js server on port 89..."
cd /app
exec node dist/server.js
