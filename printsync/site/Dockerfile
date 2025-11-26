# Build frontend assets
FROM node:20-alpine AS frontend
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY web/static web/static
COPY tailwind.config.js .
RUN npm run build:css

# Build Go binary
FROM golang:1.22-alpine AS builder
WORKDIR /app
RUN go install github.com/a-h/templ/cmd/templ@latest
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=frontend /app/web/dist/css web/dist/css
RUN templ generate
RUN go run scripts/build.go
RUN CGO_ENABLED=0 go build -ldflags="-w -s" -o /server ./cmd/server

# Runtime
FROM gcr.io/distroless/static-debian12
COPY --from=builder /server /server
COPY --from=builder /app/web/dist /web/dist
EXPOSE 8080
CMD ["/server"]
