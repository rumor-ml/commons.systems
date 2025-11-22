# Multi-stage build for mediasync (Go backend + Vite frontend)

# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /build

# Copy frontend package files
COPY mediasync/site/package*.json mediasync/site/

# Copy frontend source and shared components
COPY mediasync/site/ mediasync/site/
COPY shared-components/ shared-components/

# Install frontend dependencies
WORKDIR /build/mediasync/site
RUN npm install --production=false

# Build frontend
RUN npm run build

# Stage 2: Build Go backend
FROM golang:1.21-alpine AS backend-builder

WORKDIR /build

# Install build dependencies
RUN apk add --no-cache git

# Copy all source code
COPY gcsupload/ gcsupload/
COPY mediasync/backend/ mediasync/backend/

# Download dependencies and generate go.sum files
WORKDIR /build/gcsupload
RUN go mod tidy

WORKDIR /build/mediasync/backend
RUN go mod tidy

# Build the backend
RUN CGO_ENABLED=0 GOOS=linux go build -o /build/server ./cmd/server

# Stage 3: Production image
FROM alpine:latest

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache ca-certificates tzdata

# Copy backend binary
COPY --from=backend-builder /build/server /app/server

# Copy frontend build
COPY --from=frontend-builder /build/mediasync/site/dist /app/public

# Expose port
EXPOSE 8080

# Run the server
CMD ["/app/server"]
