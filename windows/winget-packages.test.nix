# Windows Winget Package Configuration Tests
#
# Validates the Windows package configuration (winget-packages.json):
# 1. JSON syntax is valid
# 2. Schema structure matches winget expectations
# 3. Required WezTerm package is present
# 4. No duplicate package identifiers
# 5. Package identifiers are well-formed
#
# These tests ensure invalid winget configurations are caught at build time
# (via nix build/check). Since Windows packages are installed via winget (not Nix),
# these tests provide build-time validation of the JSON config to catch errors
# before use on Windows.
#
# TODO(#1652): winget-packages.test.nix has no negative tests for invalid JSON structure
# TODO(#1635): No validation that winget packages are actually installable on Windows

{ pkgs, lib, ... }:

let
  # Path to the winget packages JSON file
  wingetPackagesPath = ./winget-packages.json;

  # Load and parse the winget packages configuration
  wingetPackages = builtins.fromJSON (builtins.readFile wingetPackagesPath);

  # Test 1: Validate JSON syntax and basic structure
  test-json-syntax =
    pkgs.runCommand "test-winget-json-syntax"
      {
        buildInputs = [ pkgs.jq ];
      }
      ''
        echo "Testing JSON syntax validation..."

        # Validate JSON syntax
        if ! ${pkgs.jq}/bin/jq empty ${wingetPackagesPath} 2>&1; then
          echo "FAIL: Invalid JSON syntax in winget-packages.json"
          exit 1
        fi

        echo "PASS: JSON syntax is valid"
        touch $out
      '';

  # Test 2: Validate required schema fields
  test-schema-structure =
    pkgs.runCommand "test-winget-schema-structure"
      {
        buildInputs = [ pkgs.jq ];
      }
      ''
        echo "Testing schema structure..."

        # Check for required top-level fields
        if ! ${pkgs.jq}/bin/jq -e '."$schema"' ${wingetPackagesPath} > /dev/null; then
          echo "FAIL: Missing required field: \$schema"
          exit 1
        fi
        echo "PASS: Schema field present"

        if ! ${pkgs.jq}/bin/jq -e '.Sources' ${wingetPackagesPath} > /dev/null; then
          echo "FAIL: Missing required field: Sources"
          exit 1
        fi
        echo "PASS: Sources field present"

        if ! ${pkgs.jq}/bin/jq -e '.WinGetVersion' ${wingetPackagesPath} > /dev/null; then
          echo "FAIL: Missing required field: WinGetVersion"
          exit 1
        fi
        echo "PASS: WinGetVersion field present"

        # Validate Sources structure
        if ! ${pkgs.jq}/bin/jq -e '.Sources | type == "array"' ${wingetPackagesPath} > /dev/null; then
          echo "FAIL: Sources must be an array"
          exit 1
        fi
        echo "PASS: Sources is an array"

        if ! ${pkgs.jq}/bin/jq -e '.Sources[0].Packages' ${wingetPackagesPath} > /dev/null; then
          echo "FAIL: Missing Packages array in first source"
          exit 1
        fi
        echo "PASS: Packages array present"

        if ! ${pkgs.jq}/bin/jq -e '.Sources[0].SourceDetails' ${wingetPackagesPath} > /dev/null; then
          echo "FAIL: Missing SourceDetails in first source"
          exit 1
        fi
        echo "PASS: SourceDetails present"

        touch $out
      '';

  # Test 3: Validate WezTerm package is present
  #
  # LIMITATION: This test only validates that the package identifier "wez.wezterm"
  # is present in the JSON structure. It CANNOT verify:
  # - The package identifier actually exists in the winget repository
  # - The package is compatible with the user's Windows version
  # - The package can be successfully installed
  # - The package hasn't been renamed, deprecated, or removed
  #
  # Why? Build-time validation runs on Linux/NixOS, which cannot query the Windows
  # winget repository. Package availability depends on runtime state of the winget
  # repository and the user's Windows environment.
  #
  # Manual verification: Users should verify package identifiers on Windows with:
  #   winget show wez.wezterm
  #
  # See windows/README.md "Verifying Package Identifiers" for full details.
  test-wezterm-package =
    pkgs.runCommand "test-winget-wezterm-package"
      {
        buildInputs = [ pkgs.jq ];
      }
      ''
        echo "Testing for required WezTerm package..."

        if ${pkgs.jq}/bin/jq -e '.Sources[].Packages[] | select(.PackageIdentifier == "wez.wezterm")' ${wingetPackagesPath} > /dev/null; then
          echo "PASS: WezTerm package (wez.wezterm) is present"
          echo ""
          echo "NOTE: This test only validates presence in JSON, not actual installability."
          echo "Package availability must be verified on Windows with: winget show wez.wezterm"
        else
          echo "FAIL: WezTerm package (wez.wezterm) is missing"
          echo ""
          echo "The WezTerm package is required for WezTerm configuration sync."
          echo "Without this package, the WezTerm config has no terminal to configure."
          echo ""
          echo "To fix: Add the following to the Packages array:"
          echo '  { "PackageIdentifier": "wez.wezterm" }'
          exit 1
        fi

        touch $out
      '';

  # Test 4: Validate no duplicate package identifiers
  test-no-duplicates =
    pkgs.runCommand "test-winget-no-duplicates"
      {
        buildInputs = [ pkgs.jq ];
      }
      ''
        echo "Testing for duplicate package identifiers..."

        # Extract all package identifiers
        PACKAGE_IDS=$(${pkgs.jq}/bin/jq -r '.Sources[].Packages[].PackageIdentifier' ${wingetPackagesPath})

        # Count total packages
        TOTAL_COUNT=$(echo "$PACKAGE_IDS" | wc -l)

        # Count unique packages
        UNIQUE_COUNT=$(echo "$PACKAGE_IDS" | sort -u | wc -l)

        if [ "$TOTAL_COUNT" != "$UNIQUE_COUNT" ]; then
          echo "FAIL: Found duplicate package identifiers"
          echo ""
          echo "All packages:"
          echo "$PACKAGE_IDS" | sort
          echo ""
          echo "Duplicates:"
          echo "$PACKAGE_IDS" | sort | uniq -d
          echo ""
          exit 1
        fi

        echo "PASS: No duplicate package identifiers (found $UNIQUE_COUNT unique packages)"
        touch $out
      '';

  # Test 5: Validate package identifier format
  test-package-identifier-format =
    pkgs.runCommand "test-winget-identifier-format"
      {
        buildInputs = [ pkgs.jq ];
      }
      ''
        echo "Testing package identifier format..."

        # Extract all package identifiers
        PACKAGE_IDS=$(${pkgs.jq}/bin/jq -r '.Sources[].Packages[].PackageIdentifier' ${wingetPackagesPath})

        # Validate each identifier format (should be Vendor.Product or Vendor.Product.Variant)
        INVALID_IDS=""
        while IFS= read -r id; do
          # Check for valid format: alphanumeric segments separated by dots
          # Must have at least one dot (Vendor.Product minimum)
          if ! echo "$id" | grep -qE '^[A-Za-z0-9]+(\.[A-Za-z0-9]+)+$'; then
            INVALID_IDS="$INVALID_IDS$id\n"
          fi
        done <<< "$PACKAGE_IDS"

        if [ -n "$INVALID_IDS" ]; then
          echo "FAIL: Found package identifiers with invalid format:"
          echo ""
          echo -e "$INVALID_IDS"
          echo ""
          echo "Package identifiers must follow the format: Vendor.Product[.Variant]"
          echo "Examples: wez.wezterm, GIMP.GIMP.3, Mozilla.Firefox"
          exit 1
        fi

        echo "PASS: All package identifiers are well-formed"
        touch $out
      '';

  # Test 6: Validate package list is not empty
  test-nonempty-packages =
    pkgs.runCommand "test-winget-nonempty"
      {
        buildInputs = [ pkgs.jq ];
      }
      ''
        echo "Testing package list is not empty..."

        PACKAGE_COUNT=$(${pkgs.jq}/bin/jq '.Sources[].Packages | length' ${wingetPackagesPath})

        if [ "$PACKAGE_COUNT" -eq 0 ]; then
          echo "FAIL: Package list is empty"
          echo ""
          echo "The winget packages configuration must include at least the WezTerm package."
          exit 1
        fi

        echo "PASS: Package list contains $PACKAGE_COUNT packages"
        touch $out
      '';

  # Test 7: Validate schema version is specified
  test-schema-version =
    pkgs.runCommand "test-winget-schema-version"
      {
        buildInputs = [ pkgs.jq ];
      }
      ''
        echo "Testing schema version..."

        SCHEMA=$(${pkgs.jq}/bin/jq -r '."$schema"' ${wingetPackagesPath})

        if [ -z "$SCHEMA" ] || [ "$SCHEMA" = "null" ]; then
          echo "FAIL: Schema version not specified"
          exit 1
        fi

        echo "PASS: Schema version specified: $SCHEMA"
        touch $out
      '';

  # Test 8: Validate SourceDetails required fields
  test-source-details =
    pkgs.runCommand "test-winget-source-details"
      {
        buildInputs = [ pkgs.jq ];
      }
      ''
        echo "Testing SourceDetails structure..."

        # Check for required SourceDetails fields
        if ! ${pkgs.jq}/bin/jq -e '.Sources[0].SourceDetails.Name' ${wingetPackagesPath} > /dev/null; then
          echo "FAIL: Missing SourceDetails.Name"
          exit 1
        fi
        echo "PASS: SourceDetails.Name present"

        if ! ${pkgs.jq}/bin/jq -e '.Sources[0].SourceDetails.Identifier' ${wingetPackagesPath} > /dev/null; then
          echo "FAIL: Missing SourceDetails.Identifier"
          exit 1
        fi
        echo "PASS: SourceDetails.Identifier present"

        if ! ${pkgs.jq}/bin/jq -e '.Sources[0].SourceDetails.Type' ${wingetPackagesPath} > /dev/null; then
          echo "FAIL: Missing SourceDetails.Type"
          exit 1
        fi
        echo "PASS: SourceDetails.Type present"

        touch $out
      '';

  # Aggregate all tests
  allTests = [
    test-json-syntax
    test-schema-structure
    test-wezterm-package
    test-no-duplicates
    test-package-identifier-format
    test-nonempty-packages
    test-schema-version
    test-source-details
  ];

  # Convenience: Run all tests in a single derivation
  winget-test-suite =
    pkgs.runCommand "winget-test-suite"
      {
        buildInputs = allTests;
      }
      ''
        echo "╔═══════════════════════════════════════════╗"
        echo "║   Windows Winget Package Tests            ║"
        echo "╚═══════════════════════════════════════════╝"
        echo ""
        ${lib.concatMapStringsSep "\n" (test: "echo \"✅ ${test.name}\"") allTests}
        echo ""
        echo "All Windows winget package tests passed!"
        touch $out
      '';

in
{
  # Export all tests as derivations that can be built
  winget-tests = {
    inherit
      test-json-syntax
      test-schema-structure
      test-wezterm-package
      test-no-duplicates
      test-package-identifier-format
      test-nonempty-packages
      test-schema-version
      test-source-details
      ;
  };

  # Convenience: Run all tests
  inherit winget-test-suite;
}
