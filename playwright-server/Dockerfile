# Use official Playwright image with pre-installed browsers
# Updated: 2025-11-23 - Concurrency set to 80 in deploy script
FROM mcr.microsoft.com/playwright:v1.40.0-jammy

# Set working directory
WORKDIR /app

# Install dependencies for the server
COPY playwright-server/package.json ./server/
WORKDIR /app/server
RUN npm install --production

# Copy server source code
COPY playwright-server/src ./src

# Install Playwright browsers (if not already in base image)
WORKDIR /app
RUN npx playwright install --with-deps chromium

# Back to server directory
WORKDIR /app/server

# Expose port (Cloud Run will set PORT env var)
EXPOSE 8080

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Run the server
CMD ["node", "src/server.js"]
