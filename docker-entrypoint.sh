#!/bin/sh
set -e

if [ ! -s data/vectors.json ]; then
  echo "Seeding knowledge base (first boot)..."
  node server/seed.js
fi

exec npm start
