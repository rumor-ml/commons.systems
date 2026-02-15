FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl jq git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm globally
RUN npm install -g pnpm@9

# Install Firebase CLI globally
RUN npm install -g firebase-tools

# Install Playwright browsers (chromium)
RUN npx playwright install chromium

# Set up workspace
WORKDIR /workspace

# Copy package files for dependency installation
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY shared/auth/package.json ./shared/auth/
COPY fellspiral/site/package.json ./fellspiral/site/
COPY fellspiral/tests/package.json ./fellspiral/tests/
COPY videobrowser/site/package.json ./videobrowser/site/
COPY videobrowser/tests/package.json ./videobrowser/tests/
COPY audiobrowser/site/package.json ./audiobrowser/site/
COPY audiobrowser/tests/package.json ./audiobrowser/tests/
COPY print/site/package.json ./print/site/
COPY print/tests/package.json ./print/tests/
COPY printsync/site/package.json ./printsync/site/
COPY printsync/tests/package.json ./printsync/tests/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Install Playwright browsers
RUN npx playwright install chromium

# Default workdir for CI jobs
WORKDIR /workspace
