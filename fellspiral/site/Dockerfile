# Multi-stage build for efficient image size
FROM node:20-alpine AS builder

WORKDIR /build

# Copy workspace root package files first
COPY ../../package*.json ./

# Copy shared auth package
COPY ../../shared/auth ./shared/auth/

# Copy site package files
COPY package*.json ./site/

# Install dependencies (workspace aware)
RUN npm install --production=false

# Copy site source files
WORKDIR /build/site
COPY . .

# Build the site
RUN npm run build

# Production stage - minimal nginx alpine image
FROM nginx:alpine

# Copy built files from builder stage
COPY --from=builder /build/site/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf.default 2>/dev/null || true

# Cloud Run expects port 8080
EXPOSE 8080

# Run nginx in foreground
CMD ["nginx", "-g", "daemon off;"]
