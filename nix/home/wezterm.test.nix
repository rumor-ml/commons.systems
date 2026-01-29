# WezTerm Module Tests
#
# Validates the WezTerm Home Manager module configuration:
# 1. Lua syntax validation for generated config
# 2. Platform-specific conditional logic (Linux/macOS)
# 3. Variable interpolation (username, home directory)
# 4. Activation script logic for WSL Windows config copy
#
# These tests ensure configuration syntax errors are caught at build time
# (via nix build/check), before home-manager switch activates the configuration.
# They do not verify runtime behavior like font availability or WSL integration.

# TODO(#1633): Test validation uses generic 'exit 1' without specific exit codes

{ pkgs, lib, ... }:

let
  # Import the wezterm module for testing
  weztermModule = import ./wezterm.nix;

  # Test helper: Evaluate module with mock config
  # Parameters:
  #   username: string (default: "testuser") - username for config interpolation
  #   homeDirectory: string (default: "/home/testuser") - home directory path
  #   isLinux: bool (default: true) - enables Linux-specific config (WSL integration)
  #   isDarwin: bool (default: false) - enables macOS-specific config
  # Returns: Home Manager module evaluation result with structure:
  #   { programs.wezterm.enable = bool
  #     programs.wezterm.extraConfig = string (Lua config)
  #     home.activation.copyWeztermToWindows = script (Linux only) }
  # TODO(#1642): Add validation invariants for mock configuration inputs
  evaluateModule =
    {
      username ? "testuser",
      homeDirectory ? "/home/testuser",
      isLinux ? true,
      isDarwin ? false,
    }:
    let
      mockPkgs = pkgs // {
        stdenv = pkgs.stdenv // {
          isLinux = isLinux;
          isDarwin = isDarwin;
        };
      };
      mockConfig = {
        home = {
          username = username;
          homeDirectory = homeDirectory;
        };
      };
    in
    weztermModule {
      config = mockConfig;
      pkgs = mockPkgs;
      lib = lib;
    };

  # Test helper: Extract Lua config from module evaluation
  extractLuaConfig = moduleResult: moduleResult.programs.wezterm.extraConfig;

  # Test helper: Validate Lua syntax using lua interpreter
  # Note: This validates Lua syntax only. For WezTerm-specific configuration
  # validation (config keys, types, etc.), see validateWeztermConfig below.
  validateLuaSyntax =
    luaCode:
    let
      luaFile = pkgs.writeText "wezterm-test.lua" luaCode;
    in
    pkgs.runCommand "validate-lua-syntax" { buildInputs = [ pkgs.lua ]; } ''
      # Validate syntax and capture error output
      if ! lua_error=$(${pkgs.lua}/bin/lua -e "assert(loadfile('${luaFile}'))" 2>&1); then
        echo "Lua syntax validation failed:"
        echo "----------------------------------------"
        echo "$lua_error"
        echo "----------------------------------------"
        echo ""
        echo "Generated Lua config (first 50 lines):"
        head -n 50 '${luaFile}'
        echo ""
        echo "Full config at: ${luaFile}"
        exit 1
      fi
      touch $out
    '';

  # Test helper: Validate config with WezTerm API structure checks
  # Creates a mock wezterm module to validate that the config uses correct WezTerm APIs
  validateWeztermConfig =
    luaCode:
    let
      luaFile = pkgs.writeText "wezterm-test.lua" luaCode;
      # Create a mock wezterm module that implements the WezTerm API structure
      # This validates that the config uses correct API calls and config keys
      mockWeztermModule = pkgs.writeText "wezterm.lua" ''
        -- Mock WezTerm module that validates API usage
        local wezterm = {}

        -- Track valid WezTerm config keys (includes all keys used in our config)
        local valid_config_keys = {
          font = true,
          font_size = true,
          color_scheme = true,
          scrollback_lines = true,
          hide_tab_bar_if_only_one_tab = true,
          window_padding = true,
          default_prog = true,
          native_macos_fullscreen_mode = true,
        }

        -- Track valid color schemes (subset - Tokyo Night is in actual WezTerm)
        local valid_color_schemes = {
          ["Tokyo Night"] = true,
          ["Tokyo Night Storm"] = true,
          ["Dracula"] = true,
          ["Solarized Dark"] = true,
        }

        -- Mock config_builder() - returns a table that validates assignments
        function wezterm.config_builder()
          local config = {}
          local mt = {
            __newindex = function(t, key, value)
              -- Validate that the key is a known WezTerm config key
              if not valid_config_keys[key] then
                error("Invalid WezTerm config key: " .. tostring(key) ..
                      "\nValid keys include: font, font_size, color_scheme, scrollback_lines, etc.")
              end

              -- Type validation for specific keys
              if key == "font_size" and type(value) ~= "number" then
                error("Config key 'font_size' must be a number, got: " .. type(value))
              end
              if key == "scrollback_lines" and type(value) ~= "number" then
                error("Config key 'scrollback_lines' must be a number, got: " .. type(value))
              end
              if key == "hide_tab_bar_if_only_one_tab" and type(value) ~= "boolean" then
                error("Config key 'hide_tab_bar_if_only_one_tab' must be a boolean, got: " .. type(value))
              end
              if key == "color_scheme" then
                if type(value) ~= "string" then
                  error("Config key 'color_scheme' must be a string, got: " .. type(value))
                end
                if not valid_color_schemes[value] then
                  error("Unknown color scheme: " .. value ..
                        "\nNote: This test validates against a subset of known schemes. " ..
                        "If you're using a valid WezTerm scheme not in the test list, " ..
                        "you may need to add it to the mock module.")
                end
              end

              -- Store the value
              rawset(t, key, value)
            end
          }
          setmetatable(config, mt)
          return config
        end

        -- Mock font() - validates font name is a string
        function wezterm.font(name)
          if type(name) ~= "string" then
            error("wezterm.font() requires a string argument, got: " .. type(name))
          end
          return { family = name }
        end

        return wezterm
      '';
      # Create a test script that loads the config with the mock module
      testScript = pkgs.writeText "wezterm-validate.lua" ''
        -- Add mock module to package.path
        package.path = "${mockWeztermModule};" .. package.path

        -- Load and execute the config file
        local config_func, load_err = loadfile('${luaFile}')
        if not config_func then
          print("Config file has Lua syntax errors:")
          print(load_err)
          os.exit(1)
        end

        -- Execute the config and catch any errors
        local success, result = pcall(config_func)
        if not success then
          print("Config execution failed:")
          print(result)
          os.exit(1)
        end

        -- Verify it returned a config table
        if type(result) ~= "table" then
          print("Config must return a table, got: " .. type(result))
          os.exit(1)
        end

        print("✓ WezTerm config validation passed")
        print("  - Config uses valid WezTerm API calls")
        print("  - All config keys are recognized by WezTerm")
        print("  - Config key types are correct")
      '';
    in
    pkgs.runCommand "validate-wezterm-config" { buildInputs = [ pkgs.lua ]; } ''
      # Run the validation script with mock WezTerm module
      if ! validation_output=$(${pkgs.lua}/bin/lua ${testScript} 2>&1); then
        echo "WezTerm configuration validation failed:"
        echo "----------------------------------------"
        echo "$validation_output"
        echo "----------------------------------------"
        echo ""
        echo "Generated Lua config (first 50 lines):"
        head -n 50 '${luaFile}'
        echo ""
        echo "Full config at: ${luaFile}"
        exit 1
      fi

      echo "$validation_output"
      touch $out
    '';

  # Test 1: Basic module structure
  test-module-structure = pkgs.runCommand "test-wezterm-module-structure" { } ''
    # Validate module returns expected attributes
    ${
      if (evaluateModule { }).programs.wezterm.enable or false then
        "echo 'PASS: Module enables wezterm'"
      else
        "echo 'FAIL: Module does not enable wezterm' && exit 1"
    }
    ${
      if (evaluateModule { }).programs.wezterm ? extraConfig then
        "echo 'PASS: Module provides extraConfig'"
      else
        "echo 'FAIL: Module missing extraConfig' && exit 1"
    }
    touch $out
  '';

  # Test 2: Linux-specific configuration
  test-linux-config =
    let
      result = evaluateModule {
        username = "linuxuser";
        homeDirectory = "/home/linuxuser";
        isLinux = true;
        isDarwin = false;
      };
      luaConfig = extractLuaConfig result;
    in
    pkgs.runCommand "test-wezterm-linux-config" { } ''
      # Validate Linux-specific WSL integration is present
      ${
        if lib.hasInfix "default_prog" luaConfig then
          "echo 'PASS: Linux config includes default_prog for WSL'"
        else
          "echo 'FAIL: Linux config missing default_prog' && exit 1"
      }
      ${
        if lib.hasInfix "wsl.exe" luaConfig then
          "echo 'PASS: Linux config includes wsl.exe'"
        else
          "echo 'FAIL: Linux config missing wsl.exe' && exit 1"
      }
      ${
        if lib.hasInfix "/home/" luaConfig && lib.hasInfix "linuxuser" luaConfig then
          "echo 'PASS: Linux config includes correct home directory'"
        else
          "echo 'FAIL: Linux config has wrong home directory' && exit 1"
      }
      ${
        if lib.hasInfix "native_macos_fullscreen_mode" luaConfig then
          "echo 'FAIL: Linux config should not include macOS settings' && exit 1"
        else
          "echo 'PASS: Linux config excludes macOS settings'"
      }
      touch $out
    '';

  # Test 3: macOS-specific configuration
  test-macos-config =
    let
      result = evaluateModule {
        username = "macuser";
        homeDirectory = "/Users/macuser";
        isLinux = false;
        isDarwin = true;
      };
      luaConfig = extractLuaConfig result;
    in
    pkgs.runCommand "test-wezterm-macos-config" { } ''
      # Validate macOS-specific settings are present
      ${
        if lib.hasInfix "native_macos_fullscreen_mode" luaConfig then
          "echo 'PASS: macOS config includes native_macos_fullscreen_mode'"
        else
          "echo 'FAIL: macOS config missing native_macos_fullscreen_mode' && exit 1"
      }
      ${
        if lib.hasInfix "default_prog" luaConfig then
          "echo 'FAIL: macOS config should not include WSL settings' && exit 1"
        else
          "echo 'PASS: macOS config excludes WSL settings'"
      }
      ${
        if lib.hasInfix "wsl.exe" luaConfig then
          "echo 'FAIL: macOS config should not include wsl.exe' && exit 1"
        else
          "echo 'PASS: macOS config excludes wsl.exe'"
      }
      touch $out
    '';

  # Test 4: Lua syntax validation for all platform combinations
  test-lua-syntax-linux =
    let
      luaConfig = extractLuaConfig (evaluateModule {
        isLinux = true;
        isDarwin = false;
      });
    in
    validateLuaSyntax luaConfig;

  test-lua-syntax-macos =
    let
      luaConfig = extractLuaConfig (evaluateModule {
        isLinux = false;
        isDarwin = true;
      });
    in
    validateLuaSyntax luaConfig;

  test-lua-syntax-generic =
    let
      luaConfig = extractLuaConfig (evaluateModule {
        isLinux = false;
        isDarwin = false;
      });
    in
    validateLuaSyntax luaConfig;

  # Test: WezTerm config validation for Linux
  test-wezterm-validation-linux =
    let
      luaConfig = extractLuaConfig (evaluateModule {
        isLinux = true;
        isDarwin = false;
      });
    in
    validateWeztermConfig luaConfig;

  # Test: WezTerm config validation for macOS
  test-wezterm-validation-macos =
    let
      luaConfig = extractLuaConfig (evaluateModule {
        isLinux = false;
        isDarwin = true;
      });
    in
    validateWeztermConfig luaConfig;

  # Test: WezTerm config validation for generic
  test-wezterm-validation-generic =
    let
      luaConfig = extractLuaConfig (evaluateModule {
        isLinux = false;
        isDarwin = false;
      });
    in
    validateWeztermConfig luaConfig;

  # Test: Invalid color scheme rejection
  # Validates that the mock WezTerm module correctly rejects unknown color schemes
  test-invalid-color-scheme =
    let
      # Create config with an invalid color scheme by injecting it after generation
      validLuaConfig = extractLuaConfig (evaluateModule {
        isLinux = true;
        isDarwin = false;
      });
      # Replace the valid color scheme with an invalid one
      invalidLuaConfig =
        builtins.replaceStrings [ "'Tokyo Night'" ] [ "'InvalidSchemeNotInMock'" ]
          validLuaConfig;

      invalidConfigFile = pkgs.writeText "invalid-config.lua" invalidLuaConfig;
    in
    pkgs.runCommand "test-invalid-color-scheme" { buildInputs = [ pkgs.lua ]; } ''
      # Create test script that loads config with mock module
      cat > test-runner.lua <<'TESTEOF'
      -- Add mock to package preload
      package.preload['wezterm'] = function()
        local wezterm = {}
        local valid_color_schemes = {
          ["Tokyo Night"] = true,
          ["Tokyo Night Storm"] = true,
          ["Dracula"] = true,
          ["Solarized Dark"] = true,
        }

        function wezterm.config_builder()
          local config = {}
          local mt = {
            __newindex = function(t, key, value)
              if key == "color_scheme" then
                if type(value) ~= "string" then
                  error("Config key 'color_scheme' must be a string, got: " .. type(value))
                end
                if not valid_color_schemes[value] then
                  error("Unknown color scheme: " .. value)
                end
              end
              rawset(t, key, value)
            end
          }
          setmetatable(config, mt)
          return config
        end

        function wezterm.font(name)
          return { family = name }
        end

        return wezterm
      end

      -- Load and execute the invalid config
      local config_func = loadfile('${invalidConfigFile}')
      local success, result = pcall(config_func)

      if success then
        print("FAIL: Invalid color scheme was NOT rejected")
        os.exit(1)
      end

      -- Check that error message mentions the invalid scheme
      if string.match(result, "Unknown color scheme") then
        print("PASS: Invalid color scheme correctly rejected")
        print("  Error message: " .. result)
        os.exit(0)
      else
        print("FAIL: Validation failed but with wrong error")
        print("  Got: " .. result)
        os.exit(1)
      end
      TESTEOF

      if ! ${pkgs.lua}/bin/lua test-runner.lua 2>&1; then
        echo "Test execution failed"
        echo "Config being tested:"
        head -n 30 '${invalidConfigFile}'
        exit 1
      fi

      touch $out
    '';

  # Test 5: Username interpolation
  test-username-interpolation =
    let
      testUsernames = [
        "alice"
        "bob-smith"
        "user_123"
      ];
      results = lib.genAttrs testUsernames (
        username:
        let
          luaConfig = extractLuaConfig (evaluateModule {
            username = username;
            isLinux = true;
          });
        in
        lib.hasInfix username luaConfig
      );
    in
    pkgs.runCommand "test-wezterm-username-interpolation" { } ''
      ${lib.concatMapStringsSep "\n" (
        username:
        if results.${username} then
          "echo 'PASS: Username ${username} interpolated correctly'"
        else
          "echo 'FAIL: Username ${username} not found in config' && exit 1"
      ) testUsernames}
      touch $out
    '';

  # Test 6: Username with special characters causing Lua injection
  test-special-chars-username =
    let
      # Test usernames that could cause Lua syntax errors with single-quoted strings
      # These are characters that are technically possible in Unix usernames
      # (though uncommon) and would break the old 'string' syntax
      testCases = [
        {
          username = "o'brien";
          description = "single quote";
        }
        {
          username = "user\"name";
          description = "double quote";
        }
        {
          username = "user\\name";
          description = "backslash";
        }
        {
          username = "user]]name";
          description = "bracket close";
        }
        {
          username = "test$user";
          description = "dollar sign";
        }
      ];
      results = map (
        testCase:
        let
          luaConfig = extractLuaConfig (evaluateModule {
            username = testCase.username;
            isLinux = true;
          });
        in
        {
          inherit (testCase) username description;
          configGenerated = luaConfig;
          syntaxValidation = validateLuaSyntax luaConfig;
        }
      ) testCases;
    in
    pkgs.runCommand "test-wezterm-special-chars-username"
      {
        buildInputs = map (r: r.syntaxValidation) results;
      }
      ''
        echo "✓ Testing usernames with special characters"
        ${lib.concatMapStringsSep "\n" (testCase: "echo \"  - ${testCase.description}\"") testCases}
        echo "All special character tests passed (validated Lua syntax)"
        touch $out
      '';

  # Test 7: Activation script conditioned on Linux platform
  test-activation-script-linux =
    let
      weztermSource = builtins.readFile ./wezterm.nix;
    in
    pkgs.runCommand "test-wezterm-activation-script-linux" { } ''
      # Validate source has activation script with Linux condition
      ${
        if lib.hasInfix "home.activation.copyWeztermToWindows" weztermSource then
          "echo 'PASS: Source includes copyWeztermToWindows activation script'"
        else
          "echo 'FAIL: Source missing activation script definition' && exit 1"
      }
      ${
        if lib.hasInfix "lib.mkIf pkgs.stdenv.isLinux" weztermSource then
          "echo 'PASS: Activation script is conditioned on Linux platform'"
        else
          "echo 'FAIL: Activation script missing Linux platform condition' && exit 1"
      }
      touch $out
    '';

  # Test 7: Activation script uses DAG ordering
  test-activation-script-dag =
    let
      weztermSource = builtins.readFile ./wezterm.nix;
    in
    pkgs.runCommand "test-wezterm-activation-script-dag" { } ''
      # Validate activation script uses proper DAG ordering
      ${
        if lib.hasInfix "lib.hm.dag.entryAfter" weztermSource then
          "echo 'PASS: Activation script uses DAG ordering'"
        else
          "echo 'FAIL: Activation script missing DAG ordering' && exit 1"
      }
      ${
        if lib.hasInfix "linkGeneration" weztermSource then
          "echo 'PASS: Activation script depends on linkGeneration'"
        else
          "echo 'FAIL: Activation script missing linkGeneration dependency' && exit 1"
      }
      touch $out
    '';

  # Test 8: Common configuration present in all platforms
  test-common-config =
    let
      testPlatforms = [
        {
          name = "linux";
          isLinux = true;
          isDarwin = false;
        }
        {
          name = "macos";
          isLinux = false;
          isDarwin = true;
        }
        {
          name = "generic";
          isLinux = false;
          isDarwin = false;
        }
      ];
      commonSettings = [
        "font"
        "font_size"
        "color_scheme"
        "scrollback_lines"
        "hide_tab_bar_if_only_one_tab"
        "window_padding"
      ];
    in
    pkgs.runCommand "test-wezterm-common-config" { } ''
      ${lib.concatMapStringsSep "\n" (
        platform:
        let
          luaConfig = extractLuaConfig (evaluateModule {
            isLinux = platform.isLinux;
            isDarwin = platform.isDarwin;
          });
        in
        lib.concatMapStringsSep "\n" (
          setting:
          if lib.hasInfix setting luaConfig then
            "echo 'PASS: ${platform.name} config includes ${setting}'"
          else
            "echo 'FAIL: ${platform.name} config missing ${setting}' && exit 1"
        ) commonSettings
      ) testPlatforms}
      touch $out
    '';

  # Test 9: Activation script source validation
  # Since the activation script uses lib.mkIf and DAG structures, we validate
  # the source wezterm.nix file directly instead of the evaluated structure
  test-activation-script-logic =
    let
      weztermSource = builtins.readFile ./wezterm.nix;
    in
    pkgs.runCommand "test-wezterm-activation-script-logic" { } ''
      # Validate script source contains expected logic
      ${
        if lib.hasInfix "/mnt/c/Users" weztermSource then
          "echo 'PASS: Activation script checks for WSL mount point'"
        else
          "echo 'FAIL: Activation script missing WSL mount check' && exit 1"
      }
      ${
        if lib.hasInfix "WINDOWS_USER" weztermSource then
          "echo 'PASS: Activation script detects Windows username'"
        else
          "echo 'FAIL: Activation script missing Windows username detection' && exit 1"
      }
      ${
        if lib.hasInfix ".wezterm.lua" weztermSource then
          "echo 'PASS: Activation script targets correct filename'"
        else
          "echo 'FAIL: Activation script missing target filename' && exit 1"
      }
      ${
        if lib.hasInfix "grep -v -E" weztermSource then
          "echo 'PASS: Activation script filters system directories'"
        else
          "echo 'FAIL: Activation script missing directory filtering' && exit 1"
      }
      ${
        if lib.hasInfix "copyWeztermToWindows" weztermSource then
          "echo 'PASS: Activation script has correct name'"
        else
          "echo 'FAIL: Activation script missing name' && exit 1"
      }
      touch $out
    '';

  # Test 10: Activation script runtime behavior
  # Tests the actual execution of Windows user detection and config copy logic
  # using shell script tests with mock /mnt/c/Users structures
  test-activation-script-runtime =
    pkgs.runCommand "test-wezterm-activation-script-runtime"
      {
        buildInputs = [ pkgs.bash ];
      }
      ''
        # Run the shell test suite
        ${pkgs.bash}/bin/bash ${./wezterm_test.sh}
        touch $out
      '';

  # Aggregate all tests into a test suite
  allTests = [
    test-module-structure
    test-linux-config
    test-macos-config
    test-lua-syntax-linux
    test-lua-syntax-macos
    test-lua-syntax-generic
    test-wezterm-validation-linux
    test-wezterm-validation-macos
    test-wezterm-validation-generic
    test-invalid-color-scheme
    test-username-interpolation
    test-special-chars-username
    test-activation-script-linux
    test-activation-script-dag
    test-common-config
    test-activation-script-logic
    test-activation-script-runtime
  ];

  # Convenience: Run all tests in a single derivation
  wezterm-test-suite = pkgs.runCommand "wezterm-test-suite" { buildInputs = allTests; } ''
    echo "╔═══════════════════════════════════════════╗"
    echo "║   WezTerm Module Test Suite              ║"
    echo "╚═══════════════════════════════════════════╝"
    echo ""
    ${lib.concatMapStringsSep "\n" (test: "echo \"✅ ${test.name}\"") allTests}
    echo ""
    echo "All WezTerm tests passed!"
    touch $out
  '';

in
{
  # Export all tests as derivations that can be built
  wezterm-tests = {
    inherit
      test-module-structure
      test-linux-config
      test-macos-config
      test-lua-syntax-linux
      test-lua-syntax-macos
      test-lua-syntax-generic
      test-wezterm-validation-linux
      test-wezterm-validation-macos
      test-wezterm-validation-generic
      test-invalid-color-scheme
      test-username-interpolation
      test-special-chars-username
      test-activation-script-linux
      test-activation-script-dag
      test-common-config
      test-activation-script-logic
      test-activation-script-runtime
      ;
  };

  # Convenience: Run all tests
  inherit wezterm-test-suite;
}
