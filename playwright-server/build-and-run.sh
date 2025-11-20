#!/bin/bash
set -e

# Script to build and run the Playwright server locally

echo "Building Docker image..."
docker build -t playwright-server:latest -f playwright-server/Dockerfile .

echo "Running Docker container..."
docker run -p 8080:8080 --rm playwright-server:latest
