.PHONY: dev build clean

dev:
	@make -j3 dev/templ dev/tailwind dev/server

dev/templ:
	templ generate --watch

dev/tailwind:
	npm run watch:css

dev/server:
	GO_ENV=development air

build:
	templ generate
	npm run build:css
	go run scripts/build.go
	go build -o bin/{{APP_NAME}} ./cmd/server

clean:
	rm -rf tmp web/dist bin
