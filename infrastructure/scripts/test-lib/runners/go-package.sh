#!/bin/bash
# Go package test runner

run_go_package_tests() {
  local pkg_path="$1"
  local test_type="$2"
  local filter_args="$3"
  local extra_args="$4"

  local pkg_name=$(basename "$pkg_path")

  case "$test_type" in
    unit)
      # Run Go tests
      cd "$pkg_path"
      go test -v $filter_args $extra_args ./...
      ;;
    *)
      echo "Unsupported test type for Go package: $test_type"
      return 1
      ;;
  esac
}
