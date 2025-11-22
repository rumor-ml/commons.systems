# Multi-stage build for audioupload (Go backend + Vite frontend)

# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /build

# Copy frontend package files
COPY audioupload/site/package*.json audioupload/site/

# Copy frontend source and shared components
COPY audioupload/site/ audioupload/site/
COPY shared-components/ shared-components/

# Install frontend dependencies
WORKDIR /build/audioupload/site
RUN npm install --production=false

# Build frontend
RUN npm run build

# Stage 2: Build Go backend
FROM golang:1.21-alpine AS backend-builder

WORKDIR /build

# Install build dependencies
RUN apk add --no-cache git

# Copy Go modules
COPY gcsupload/go.mod gcsupload/go.sum* gcsupload/
COPY audioupload/backend/go.mod audioupload/backend/go.sum* audioupload/backend/

# Download dependencies
WORKDIR /build/gcsupload
RUN go mod download || true

WORKDIR /build/audioupload/backend
RUN go mod download || true

# Copy source code
COPY gcsupload/ gcsupload/
COPY audioupload/backend/ audioupload/backend/

# Build the backend
WORKDIR /build/audioupload/backend
RUN CGO_ENABLED=0 GOOS=linux go build -o /build/server ./cmd/server

# Stage 3: Production image
FROM alpine:latest

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache ca-certificates tzdata

# Copy backend binary
COPY --from=backend-builder /build/server /app/server

# Copy frontend build
COPY --from=frontend-builder /build/audioupload/site/dist /app/public

# Expose port
EXPOSE 8080

# Run the server
CMD ["/app/server"]
