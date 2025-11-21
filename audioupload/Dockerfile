# Multi-stage build for audioupload (Go backend + Vite frontend)

# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /build/frontend

# Copy frontend package files
COPY site/package*.json ./

# Install frontend dependencies
RUN npm install --production=false

# Copy frontend source and shared components
COPY site/ ./
COPY shared-components/ /build/shared-components/

# Build frontend
RUN npm run build

# Stage 2: Build Go backend
FROM golang:1.21-alpine AS backend-builder

WORKDIR /build

# Install build dependencies
RUN apk add --no-cache git

# Copy Go modules
COPY gcsupload/go.mod gcsupload/go.sum /build/gcsupload/
COPY backend/go.mod backend/go.sum* /build/backend/

# Download dependencies
WORKDIR /build/gcsupload
RUN go mod download || true

WORKDIR /build/backend
RUN go mod download || true

# Copy source code
COPY gcsupload/ /build/gcsupload/
COPY backend/ /build/backend/

# Build the backend
WORKDIR /build/backend
RUN CGO_ENABLED=0 GOOS=linux go build -o /build/server ./cmd/server

# Stage 3: Production image
FROM alpine:latest

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache ca-certificates tzdata

# Copy backend binary
COPY --from=backend-builder /build/server /app/server

# Copy frontend build
COPY --from=frontend-builder /build/frontend/dist /app/public

# Expose port
EXPOSE 8080

# Run the server
CMD ["/app/server"]
