#!/usr/bin/env bash
# exit on error
set -o errexit

echo "Installing node dependencies..."
PUPPETEER_CACHE_DIR=./.cache/puppeteer npm install

echo "Installing Chrome browser binary..."
PUPPETEER_CACHE_DIR=./.cache/puppeteer npx puppeteer browsers install chrome

echo "Build process completed successfully!"
