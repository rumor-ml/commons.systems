.PHONY: dev build clean copy-vendor

copy-vendor:
	@echo "Copying shared libraries to vendor directory..."
	@mkdir -p web/dist/js/vendor/@commons/auth/src
	@cp -r ../../shared/auth/src/* web/dist/js/vendor/@commons/auth/src/
	@cp ../../shared/auth/package.json web/dist/js/vendor/@commons/auth/
	@echo 'export * from "./src/index.js";' > web/dist/js/vendor/@commons/auth/index.js
	@echo "✓ Vendor libraries copied"

dev: copy-vendor
	@make -j3 dev/templ dev/tailwind dev/server

dev/templ:
	templ generate --watch

dev/tailwind:
	npx tailwindcss -i web/static/css/input.css -o web/dist/css/styles.css --watch

dev/server:
	GO_ENV=development \
	FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
	FIRESTORE_EMULATOR_HOST=localhost:8081 \
	STORAGE_EMULATOR_HOST=localhost:9199 \
	GCP_PROJECT_ID=demo-test \
	air

build: copy-vendor
	templ generate
	npx tailwindcss -i web/static/css/input.css -o web/dist/css/styles.css --minify
	go run scripts/build.go
	go build -o bin/printsync ./cmd/server

clean:
	rm -rf tmp web/dist bin
