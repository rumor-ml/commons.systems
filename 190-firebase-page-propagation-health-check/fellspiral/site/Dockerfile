# Multi-stage build for efficient image size
FROM node:20-alpine AS builder

# Build arg for site directory (e.g., "fellspiral/site")
ARG SITE_DIR

WORKDIR /build

# Copy workspace root package files
COPY package*.json ./

# Copy shared auth package
COPY shared/auth ./shared/auth/

# Copy site files
COPY ${SITE_DIR} ./${SITE_DIR}/

# Install dependencies (workspace aware)
RUN npm install --production=false

# Build the site
WORKDIR /build/${SITE_DIR}
RUN npm run build

# Production stage - minimal nginx alpine image
FROM nginx:alpine

# Build arg for site directory
ARG SITE_DIR

# Copy built files from builder stage
COPY --from=builder /build/${SITE_DIR}/dist /usr/share/nginx/html

# Copy nginx configuration from site directory
COPY ${SITE_DIR}/nginx.conf /etc/nginx/conf.d/default.conf

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf.default 2>/dev/null || true

# Cloud Run expects port 8080
EXPOSE 8080

# Run nginx in foreground
CMD ["nginx", "-g", "daemon off;"]
