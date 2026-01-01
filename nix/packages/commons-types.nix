# commons-types: Shared branded types for type safety across commons.systems
#
# This package provides branded type utilities for type-safe IDs and values:
# - Branded type definitions (Brand, Branded)
# - Type safety utilities
#
# Build process:
# - buildNpmPackage automatically runs: npm ci && npm run build
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

  # Simple build - just TypeScript compilation
  # buildNpmPackage handles: npm ci && npm run build
  # No special hooks needed since there are no workspace dependencies

  meta = with lib; {
    description = "Shared branded types for type safety across commons.systems";
    homepage = "https://github.com/commons-systems/commons-types";
    license = licenses.isc;
    maintainers = [ ];
    platforms = platforms.unix;
  };
}
