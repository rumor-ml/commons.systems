# commons-types: Shared branded types for type safety across commons.systems
#
# This package provides branded type utilities for type-safe IDs and values:
# - Branded type definitions (Port, URL, Timestamp, SessionID, UserID, FileID)
# - Zod schemas for runtime validation (PortSchema, URLSchema, etc.)
# - Factory functions for creating branded values (createPort, createURL, etc.)
#
# TODO(#1236): Comment about build phases is misleading - npm ci is in configure phase, not build phase
# Build process:
# - buildNpmPackage's default build phase runs: npm ci --offline && npm run build
#   This works for our package because package.json's build script runs 'tsc'
# - Outputs to dist/ directory with .js, .d.ts, and source map files
#
# Usage in flake.nix:
#   commons-types = pkgs.callPackage ./nix/packages/commons-types.nix { };
# Usage in other packages:
#   buildInputs = [ commons-types ];
#
{
  lib,
  buildNpmPackage,
  nodejs,
  typescript,
}:

buildNpmPackage {
  pname = "commons-types";
  version = "1.0.0";

  # Provide TypeScript as a build input to ensure tsc is available in PATH during build
  # While buildNpmPackage installs devDependencies via npm ci (including TypeScript),
  # providing it explicitly in nativeBuildInputs ensures we use the Nix-pinned version
  # for reproducible builds across environments, rather than relying on the version
  # resolved from package.json which may vary with npm's dependency resolution.
  nativeBuildInputs = [
    nodejs
    typescript
  ];

  # Include all source files
  # dist/ is build output (not in git and explicitly filtered out below), generated during the build phase
  src = builtins.path {
    path = ../../shared/types;
    name = "commons-types-source";
    filter =
      path: type:
      let
        baseName = baseNameOf path;
      in
      # Include all files except build artifacts, git, and temp files
      # Blacklist approach: new files are included by default unless explicitly excluded
      baseName != ".git"
      && baseName != "node_modules"
      && baseName != "dist"
      && baseName != ".direnv"
      && !(lib.hasSuffix ".swp" baseName)
      && !(lib.hasSuffix "~" baseName);
  };

  # Package has zod as a runtime dependency via pnpm workspace
  # pnpm workspace links use 'workspace:*' protocol without resolved URLs,
  # which breaks Nix's npmDepsHash calculation. We use a generated package-lock.json
  # and fetch all dependencies explicitly.
  npmDepsHash = "sha256-V8Sufeqx0pOtV9zZHly7Ws+eo/+GDm25xGZ4XOzzv8M=";

  # TODO(#1127): Consider adding integration test for Nix build output and package exports
  # Simple build - just TypeScript compilation
  # This package has no dependencies on other workspace packages, so no special hooks or workspace linking needed

  # Verify build output completeness
  doInstallCheck = true;
  installCheckPhase = ''
    set -euo pipefail  # Fail fast on errors, undefined variables, and pipeline failures

    echo "=== Build Verification ==="
    echo "Checking build outputs in: $out/lib/node_modules/@commons/types/dist/"

    DIST_DIR="$out/lib/node_modules/@commons/types/dist/"

    # Show what files were actually generated
    echo "Files present in dist/:"
    if [ -d "$DIST_DIR" ]; then
      ls -la "$DIST_DIR"
    else
      echo "ERROR: dist/ directory does not exist at $DIST_DIR"
      exit 1
    fi

    # Track success/failure for all checks
    CHECKS_PASSED=0
    CHECKS_FAILED=0

    # Verify expected outputs exist
    echo ""
    echo "Checking compiled JavaScript output..."
    if [ ! -e "$out/lib/node_modules/@commons/types/dist/branded.js" ]; then
      echo "  ❌ FAILED: branded.js does not exist"
      CHECKS_FAILED=$(($CHECKS_FAILED + 1))
    elif [ ! -f "$out/lib/node_modules/@commons/types/dist/branded.js" ]; then
      echo "  ❌ FAILED: branded.js exists but is not a regular file"
      ls -la "$out/lib/node_modules/@commons/types/dist/branded.js"
      CHECKS_FAILED=$(($CHECKS_FAILED + 1))
    else
      echo "  ✓ PASSED: branded.js present"
      CHECKS_PASSED=$(($CHECKS_PASSED + 1))
    fi

    echo "Checking TypeScript declaration files..."
    if [ ! -e "$out/lib/node_modules/@commons/types/dist/branded.d.ts" ]; then
      echo "  ❌ FAILED: branded.d.ts does not exist"
      CHECKS_FAILED=$(($CHECKS_FAILED + 1))
    elif [ ! -f "$out/lib/node_modules/@commons/types/dist/branded.d.ts" ]; then
      echo "  ❌ FAILED: branded.d.ts exists but is not a regular file"
      ls -la "$out/lib/node_modules/@commons/types/dist/branded.d.ts"
      CHECKS_FAILED=$(($CHECKS_FAILED + 1))
    else
      echo "  ✓ PASSED: branded.d.ts present"
      CHECKS_PASSED=$(($CHECKS_PASSED + 1))
    fi

    echo "Checking source maps..."
    if [ ! -e "$out/lib/node_modules/@commons/types/dist/branded.js.map" ]; then
      echo "  ❌ FAILED: branded.js.map does not exist"
      CHECKS_FAILED=$(($CHECKS_FAILED + 1))
    elif [ ! -f "$out/lib/node_modules/@commons/types/dist/branded.js.map" ]; then
      echo "  ❌ FAILED: branded.js.map exists but is not a regular file"
      ls -la "$out/lib/node_modules/@commons/types/dist/branded.js.map"
      CHECKS_FAILED=$(($CHECKS_FAILED + 1))
    else
      echo "  ✓ PASSED: branded.js.map present"
      CHECKS_PASSED=$(($CHECKS_PASSED + 1))
    fi

    echo ""
    echo "=== Verification Summary ==="
    echo "Passed: $CHECKS_PASSED/3"
    echo "Failed: $CHECKS_FAILED/3"

    if [ "$CHECKS_FAILED" -gt 0 ]; then
      echo ""
      echo "Build verification FAILED. See errors above."
      exit 1
    fi

    echo "Build verification complete: all expected outputs present"
  '';

  meta = with lib; {
    description = "Shared branded types for type safety across commons.systems";
    homepage = "https://github.com/commons-systems/commons-types";
    license = licenses.isc;
    maintainers = [ ];
    platforms = platforms.unix;
  };
}
