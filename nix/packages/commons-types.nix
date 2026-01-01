# commons-types: Shared branded types for type safety across commons.systems
#
# This package provides branded type utilities for type-safe IDs and values:
# - Branded type definitions (Brand)
# - Type safety utilities
#
# Build process:
# - buildNpmPackage's default build phase runs: npm ci && npm run build
# - The build script in package.json is "tsc" (TypeScript compilation)
# - Outputs to dist/ directory with .js, .d.ts, and source map files
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

  # Provide TypeScript as a build input since devDependencies won't be installed
  nativeBuildInputs = [
    nodejs
    typescript
  ];

  # Include all source files (no dist/ since it's not git-tracked)
  src = builtins.path {
    path = ../../shared/types;
    name = "commons-types-source";
    filter =
      path: type:
      let
        baseName = baseNameOf path;
      in
      # Exclude build artifacts, git, and temp files
      baseName != ".git"
      && baseName != "node_modules"
      && baseName != "dist"
      && baseName != ".direnv"
      && !(lib.hasSuffix ".swp" baseName)
      && !(lib.hasSuffix "~" baseName);
  };

  # Package now has zod as a runtime dependency
  # pnpm workspace links don't have resolved URLs, so we use forceEmptyCache
  npmDepsHash = "sha256-KWjsYQblTA5kN+5SpjBNEU+kOHhZPS2r/3IswM23oHs=";
  forceEmptyCache = true;

  # TODO(#1127): Consider adding integration test for Nix build output and package exports
  # Simple build - just TypeScript compilation, no workspace dependencies or special hooks needed

  # Verify build output completeness
  doInstallCheck = true;
  installCheckPhase = ''
    # Verify expected outputs exist
    if [ ! -f "$out/lib/node_modules/@commons/types/dist/branded.js" ]; then
      echo "ERROR: Missing compiled JavaScript output"
      exit 1
    fi

    if [ ! -f "$out/lib/node_modules/@commons/types/dist/branded.d.ts" ]; then
      echo "ERROR: Missing TypeScript declaration files"
      exit 1
    fi

    if [ ! -f "$out/lib/node_modules/@commons/types/dist/branded.js.map" ]; then
      echo "ERROR: Missing source maps"
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
