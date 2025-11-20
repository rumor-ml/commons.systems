# Use official Playwright image with pre-installed browsers
FROM mcr.microsoft.com/playwright:v1.40.0-jammy

# Set working directory
WORKDIR /app

# Install dependencies for the server
COPY playwright-server/package.json ./server/
WORKDIR /app/server
RUN npm install --production

# Copy server source code
COPY playwright-server/src ./src

# Copy the site directory (tests may need to serve it)
WORKDIR /app
COPY fellspiral/site ./site
WORKDIR /app/site
RUN npm install && npm run build

# Copy the tests directory and its dependencies
WORKDIR /app
COPY fellspiral/tests ./tests
WORKDIR /app/tests
RUN npm install

# Install Playwright browsers (if not already in base image)
RUN npx playwright install --with-deps chromium

# Create directory for test results
RUN mkdir -p /app/tests/test-results

# Back to server directory
WORKDIR /app/server

# Expose port (Cloud Run will set PORT env var)
EXPOSE 8080

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Run the server
CMD ["node", "src/server.js"]
