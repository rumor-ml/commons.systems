# Multi-stage build for efficient image size
FROM node:20-alpine AS builder

WORKDIR /build

# Copy package files
COPY package*.json ./

# Install dependencies (use install instead of ci for workspace compatibility)
RUN npm install --production=false

# Copy source files
COPY . .

# Build the site
RUN npm run build

# Production stage - minimal nginx alpine image
FROM nginx:alpine

# Copy built files from builder stage
COPY --from=builder /build/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf.default 2>/dev/null || true

# Cloud Run expects port 8080
EXPOSE 8080

# Run nginx in foreground
CMD ["nginx", "-g", "daemon off;"]
