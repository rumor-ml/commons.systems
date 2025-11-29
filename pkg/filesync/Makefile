.PHONY: test test-unit test-integration

test: test-unit test-integration

test-unit:
	go test -v -json -short ./...

test-integration:
	../../infrastructure/scripts/run-go-tests.sh
