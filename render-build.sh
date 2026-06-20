#!/usr/bin/env bash
# exit on error
set -o errexit

# Ensure the Puppeteer cache directory is an absolute path to prevent extraction errors
export PUPPETEER_CACHE_DIR="/opt/render/project/src/.cache/puppeteer"

echo "Installing node dependencies..."
npm install

echo "Installing Chrome browser binary..."
npx puppeteer browsers install chrome

echo "Build process completed successfully!"
