.PHONY: test test-unit test-integration

test: test-unit test-integration

test-unit:
	go test -v -json -short ./...

test-integration:
	cd ../../ && ./infrastructure/scripts/test.sh --module=filesync --type=integration
