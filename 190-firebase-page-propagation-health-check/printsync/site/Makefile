.PHONY: dev build clean

dev:
	@make -j3 dev/templ dev/tailwind dev/server

dev/templ:
	templ generate --watch

dev/tailwind:
	npx tailwindcss -i web/static/css/input.css -o web/dist/css/styles.css --watch

dev/server:
	GO_ENV=development air

build:
	templ generate
	npx tailwindcss -i web/static/css/input.css -o web/dist/css/styles.css --minify
	go run scripts/build.go
	go build -o bin/printsync ./cmd/server

clean:
	rm -rf tmp web/dist bin
