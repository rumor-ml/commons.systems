.PHONY: test test-unit test-integration

test: test-unit test-integration

test-unit:
	go test -v -short ./...

test-integration:
	../../infrastructure/scripts/run-go-tests.sh
