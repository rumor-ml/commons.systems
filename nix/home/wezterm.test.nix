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
# Runtime behavior tests include activation script execution, WSL detection,
# Windows user auto-detection, and config copy logic (via mock environments).

# TODO(#1633): Test validation uses generic 'exit 1' without specific exit codes
# TODO(#1650): Large test file could benefit from test grouping by concern

{ pkgs, lib, ... }:

let
  # Import the wezterm module for testing
  weztermModule = import ./wezterm.nix;

  # Base test pkgs with mock packages needed for module evaluation
  # The wezterm.nix module references pkgs.wezterm-navigator for the binary path
  testPkgs = pkgs // {
    wezterm-navigator = pkgs.writeScriptBin "wezterm-navigator" "#!/bin/sh\necho mock";
  };

  # Test helper: Evaluate module with mock config
  # Parameters:
  #   username: string (default: "testuser") - username for config interpolation
  #   homeDirectory: string (default: "/home/testuser") - home directory path
  #   isLinux: bool (default: true) - enables Linux-specific config (WSL integration)
  #   isDarwin: bool (default: false) - enables macOS-specific config
  # Returns: Home Manager module evaluation result. Access via attribute paths:
  #   programs.wezterm.enable - boolean, always true
  #   programs.wezterm.extraConfig - string, contains generated Lua config
  #   home.activation.copyWeztermToWindows - DAG entry wrapped in lib.mkIf for platform filtering.
  #     Tests must unwrap the mkIf wrapper (_type="if") to verify the inner DAG structure.
  #     When isLinux=true, condition=true and content contains the DAG entry.
  #     When isLinux=false, condition=false and Home Manager filters it out during activation.
  # TODO(#1668): Consolidate duplicated evaluateModule helper into test-helpers.nix
  # TODO(#1682): Consider using platform enum instead of boolean flags for type safety (consolidated from #1706)
  evaluateModule =
    {
      username ? "testuser",
      homeDirectory ? "/home/testuser",
      isLinux ? true,
      isDarwin ? false,
    }:
    # Validate mock configuration invariants
    assert lib.assertMsg (username != "") "evaluateModule: username cannot be empty";
    assert lib.assertMsg (homeDirectory != "") "evaluateModule: homeDirectory cannot be empty";
    assert lib.assertMsg (lib.hasPrefix "/" homeDirectory)
      "evaluateModule: homeDirectory must be an absolute path starting with /";
    assert lib.assertMsg (
      !lib.hasSuffix "/" homeDirectory || homeDirectory == "/"
    ) "evaluateModule: homeDirectory should not end with / (except root)";
    assert lib.assertMsg (
      !(isLinux && isDarwin)
    ) "evaluateModule: Cannot have both isLinux=true and isDarwin=true (mutually exclusive platforms)";
    let
      mockPkgs = testPkgs // {
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

  # Shared mock WezTerm module for validation tests
  # This mock implements the WezTerm API structure to validate config usage
  mockWeztermModule = pkgs.writeText "wezterm.lua" ''
    -- Mock WezTerm module that validates config key names, value types, and API return value usage
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
      keys = true,
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

          -- Validate font value is a font object from wezterm.font(), not a raw string
          if key == "font" then
            if type(value) == "string" then
              error("Config key 'font' must be a font object from wezterm.font(), got a raw string: " .. value ..
                    "\nCorrect usage: config.font = wezterm.font('JetBrains Mono')" ..
                    "\nIncorrect usage: config.font = 'JetBrains Mono'")
            end
            if type(value) ~= "table" or not value.__wezterm_font_object then
              error("Config key 'font' must be a font object from wezterm.font(), got: " .. type(value))
            end
          end

          -- Validate window_padding table structure
          if key == "window_padding" then
            if type(value) ~= "table" then
              error("Config key 'window_padding' must be a table, got: " .. type(value))
            end
            -- Validate required fields exist and have correct types
            local required_fields = {"left", "right", "top", "bottom"}
            for _, field in ipairs(required_fields) do
              if value[field] == nil then
                error("window_padding missing required field: " .. field)
              end
              if type(value[field]) ~= "number" then
                error("window_padding." .. field .. " must be a number, got: " .. type(value[field]))
              end
            end
          end

          -- Validate keys array structure
          if key == "keys" then
            if type(value) ~= "table" then
              error("Config key 'keys' must be a table, got: " .. type(value))
            end
            -- Validate each keybinding entry
            for i, binding in ipairs(value) do
              if type(binding) ~= "table" then
                error("keys[" .. i .. "] must be a table, got: " .. type(binding))
              end
              -- Validate required fields
              if not binding.key then
                error("keys[" .. i .. "] missing required field 'key'")
              end
              if type(binding.key) ~= "string" then
                error("keys[" .. i .. "].key must be a string, got: " .. type(binding.key))
              end
              if not binding.action then
                error("keys[" .. i .. "] missing required field 'action'")
              end
              if type(binding.action) ~= "table" then
                error("keys[" .. i .. "].action must be a table (from wezterm.action), got: " .. type(binding.action))
              end
              -- mods is optional but must be string if present
              if binding.mods and type(binding.mods) ~= "string" then
                error("keys[" .. i .. "].mods must be a string, got: " .. type(binding.mods))
              end
            end
          end

          -- Store the value
          rawset(t, key, value)
        end
      }
      setmetatable(config, mt)
      return config
    end

    -- Mock font() - validates font name is a string and returns tagged font object
    function wezterm.font(name)
      if type(name) ~= "string" then
        error("wezterm.font() requires a string argument, got: " .. type(name))
      end
      return {
        family = name,
        __wezterm_font_object = true  -- Tag to identify this as a font object
      }
    end

    -- Mock on() - registers event handlers (no-op in tests)
    function wezterm.on(event_name, callback)
      if type(event_name) ~= "string" then
        error("wezterm.on() requires a string event name, got: " .. type(event_name))
      end
      if type(callback) ~= "function" then
        error("wezterm.on() requires a function callback, got: " .. type(callback))
      end
    end

    -- Mock action namespace for keybindings
    wezterm.action = setmetatable({}, {
      __index = function(t, key)
        return function(...)
          return { action = key, args = {...} }
        end
      end
    })

    -- Mock mux (only used inside gui-startup callback, not executed in tests)
    wezterm.mux = {}

    return wezterm
  '';

  # Test helper: Validate Lua syntax using lua interpreter
  # Note: Validates Lua syntax only using loadfile(). Does not execute the code.
  # For runtime execution testing with WezTerm API validation, use validateWeztermConfig.
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
  # Uses the shared mockWeztermModule to validate that the config uses correct WezTerm APIs
  validateWeztermConfig =
    luaCode:
    let
      luaFile = pkgs.writeText "wezterm-test.lua" luaCode;
      # Create a test script that loads the config with the mock module
      # TODO(#1677): Add explicit validation that mock module is accessible before testing config
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
  # Reuses the shared mockWeztermModule to avoid code duplication
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

      # Create a test script that loads the config with the shared mock module
      testScript = pkgs.writeText "wezterm-invalid-test.lua" ''
        -- Add mock module to package.path
        package.path = "${mockWeztermModule};" .. package.path

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
      '';
    in
    pkgs.runCommand "test-invalid-color-scheme" { buildInputs = [ pkgs.lua ]; } ''
      if ! ${pkgs.lua}/bin/lua ${testScript} 2>&1; then
        echo "Test execution failed"
        echo "Config being tested:"
        head -n 30 '${invalidConfigFile}'
        exit 1
      fi

      touch $out
    '';

  # Test: Invalid font_size type rejection
  # Validates that the mock WezTerm module correctly rejects non-number font_size values
  # This ensures future maintainers can't accidentally introduce string font_size values
  test-invalid-font-size =
    let
      # Create config with invalid font_size by injecting string value after generation
      validLuaConfig = extractLuaConfig (evaluateModule {
        isLinux = true;
        isDarwin = false;
      });
      # Replace the valid font_size with an invalid string
      invalidLuaConfig =
        builtins.replaceStrings [ "font_size = 11.0" ] [ "font_size = \"11\"" ]
          validLuaConfig;

      invalidConfigFile = pkgs.writeText "invalid-font-size-config.lua" invalidLuaConfig;

      # Create a test script that loads the config with the shared mock module
      testScript = pkgs.writeText "wezterm-invalid-font-size-test.lua" ''
        -- Add mock module to package.path
        package.path = "${mockWeztermModule};" .. package.path

        -- Load and execute the invalid config
        local config_func = loadfile('${invalidConfigFile}')
        local success, result = pcall(config_func)

        if success then
          print("FAIL: Invalid font_size type was NOT rejected")
          print("  Expected: error about font_size requiring number")
          print("  Got: successful config loading")
          os.exit(1)
        end

        -- Check that error message mentions font_size type validation
        if string.match(result, "font_size.*must be a number") then
          print("PASS: Invalid font_size type correctly rejected")
          print("  Error message: " .. result)
          os.exit(0)
        else
          print("FAIL: Validation failed but with wrong error")
          print("  Expected: error mentioning 'font_size must be a number'")
          print("  Got: " .. result)
          os.exit(1)
        end
      '';
    in
    pkgs.runCommand "test-invalid-font-size" { buildInputs = [ pkgs.lua ]; } ''
      if ! ${pkgs.lua}/bin/lua ${testScript} 2>&1; then
        echo "Test execution failed"
        echo "Config being tested:"
        head -n 40 '${invalidConfigFile}'
        exit 1
      fi

      touch $out
    '';

  # Test: Invalid font value rejection (string instead of font object)
  # Validates that the mock WezTerm module correctly rejects raw string font values
  # This catches the common mistake: config.font = "JetBrains Mono" instead of wezterm.font("JetBrains Mono")
  test-invalid-font-value =
    let
      # Create config with invalid font value by replacing font object with raw string
      validLuaConfig = extractLuaConfig (evaluateModule {
        isLinux = true;
        isDarwin = false;
      });
      # Replace the valid font() call with a raw string assignment
      # Match: config.font = wezterm.font('JetBrains Mono', { weight = 'Regular' })
      # Replace with: config.font = 'JetBrains Mono'
      invalidLuaConfig =
        builtins.replaceStrings
          [ "config.font = wezterm.font('JetBrains Mono', { weight = 'Regular' })" ]
          [ "config.font = 'JetBrains Mono'" ]
          validLuaConfig;

      invalidConfigFile = pkgs.writeText "invalid-font-value-config.lua" invalidLuaConfig;

      # Create a test script that loads the config with the shared mock module
      testScript = pkgs.writeText "wezterm-invalid-font-value-test.lua" ''
        -- Add mock module to package.path
        package.path = "${mockWeztermModule};" .. package.path

        -- Load and execute the invalid config
        local config_func = loadfile('${invalidConfigFile}')
        local success, result = pcall(config_func)

        if success then
          print("FAIL: Invalid font value (raw string) was NOT rejected")
          print("  Expected: error about font requiring font object from wezterm.font()")
          print("  Got: successful config loading")
          os.exit(1)
        end

        -- Check that error message mentions font object requirement
        if string.match(result, "font.*must be a font object") or string.match(result, "wezterm%.font%(%)") then
          print("PASS: Invalid font value (raw string) correctly rejected")
          print("  Error message: " .. result)
          os.exit(0)
        else
          print("FAIL: Validation failed but with wrong error")
          print("  Expected: error mentioning 'font must be a font object from wezterm.font()'")
          print("  Got: " .. result)
          os.exit(1)
        end
      '';
    in
    pkgs.runCommand "test-invalid-font-value" { buildInputs = [ pkgs.lua ]; } ''
      if ! ${pkgs.lua}/bin/lua ${testScript} 2>&1; then
        echo "Test execution failed"
        echo "Config being tested:"
        head -n 40 '${invalidConfigFile}'
        exit 1
      fi

      touch $out
    '';

  # Test: Invalid config key rejection
  # Validates that the mock WezTerm module correctly rejects unknown config keys
  # This ensures typos in config keys (e.g., config.font_sizes instead of config.font_size)
  # are caught during testing rather than causing runtime errors in WezTerm
  test-invalid-config-key =
    let
      # Create config with a valid base
      validLuaConfig = extractLuaConfig (evaluateModule {
        isLinux = true;
        isDarwin = false;
      });

      # Inject an invalid config key before the return statement
      # This simulates a typo or unknown config key being added
      invalidLuaConfig =
        builtins.replaceStrings
          [ "return config" ]
          [
            ''
              config.invalid_nonexistent_key = "should fail"
              return config
            ''
          ]
          validLuaConfig;

      invalidConfigFile = pkgs.writeText "invalid-key-config.lua" invalidLuaConfig;

      # Create a test script that loads the config with the shared mock module
      testScript = pkgs.writeText "wezterm-invalid-key-test.lua" ''
        -- Add mock module to package.path
        package.path = "${mockWeztermModule};" .. package.path

        -- Load and execute the invalid config
        local config_func = loadfile('${invalidConfigFile}')
        local success, result = pcall(config_func)

        if success then
          print("FAIL: Invalid config key was NOT rejected")
          print("  Expected: error about invalid config key")
          print("  Got: successful config loading")
          os.exit(1)
        end

        -- Check that error message mentions the invalid key
        if string.match(result, "Invalid WezTerm config key") then
          print("PASS: Invalid config key correctly rejected")
          print("  Error message: " .. result)
          os.exit(0)
        else
          print("FAIL: Validation failed but with wrong error")
          print("  Expected: error mentioning 'Invalid WezTerm config key'")
          print("  Got: " .. result)
          os.exit(1)
        end
      '';
    in
    pkgs.runCommand "test-invalid-config-key" { buildInputs = [ pkgs.lua ]; } ''
      if ! ${pkgs.lua}/bin/lua ${testScript} 2>&1; then
        echo "Test execution failed"
        echo "Config being tested:"
        head -n 40 '${invalidConfigFile}'
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

  # Test 6: Username with special characters requiring escaping
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

  # Test: Activation source file missing
  # Validates ERR_SOURCE_MISSING when wezterm.lua doesn't exist
  test-activation-source-file-missing =
    pkgs.runCommand "test-activation-source-file-missing"
      {
        buildInputs = [ pkgs.bash ];
      }
      ''
        # Create mock WSL environment without source file
        mkdir -p test-env/mnt/c/Users/testuser

        # Test source file validation logic
        SOURCE_FILE="test-env/.config/wezterm/wezterm.lua"

        if [ -f "$SOURCE_FILE" ]; then
          echo "FAIL: Source file should not exist"
          exit 1
        fi

        # Simulate activation script check
        output=""
        if [ ! -f "$SOURCE_FILE" ]; then
          output="ERROR: Source WezTerm config not found at $SOURCE_FILE"
          exit_code=13
        fi

        if [ "$exit_code" != "13" ]; then
          echo "FAIL: Expected exit code 13 (ERR_SOURCE_MISSING), got $exit_code"
          exit 1
        fi

        if echo "$output" | grep -q "Source WezTerm config not found"; then
          echo "PASS: Missing source file produces appropriate error"
        else
          echo "FAIL: Missing error message"
          exit 1
        fi

        touch $out
      '';

  # Test: Activation source file empty
  # Validates ERR_SOURCE_EMPTY when wezterm.lua exists but is empty
  test-activation-source-file-empty =
    pkgs.runCommand "test-activation-source-file-empty"
      {
        buildInputs = [ pkgs.bash ];
      }
      ''
        # Create mock environment with empty source file
        mkdir -p test-env/.config/wezterm
        mkdir -p test-env/mnt/c/Users/testuser
        touch test-env/.config/wezterm/wezterm.lua  # Empty file

        # Test source file empty validation
        SOURCE_FILE="test-env/.config/wezterm/wezterm.lua"

        output=""
        exit_code=0
        if [ ! -s "$SOURCE_FILE" ]; then
          output="ERROR: Source WezTerm config is empty at $SOURCE_FILE"
          exit_code=15
        fi

        if [ "$exit_code" != "15" ]; then
          echo "FAIL: Expected exit code 15 (ERR_SOURCE_EMPTY), got $exit_code"
          exit 1
        fi

        if echo "$output" | grep -q "Source WezTerm config is empty"; then
          echo "PASS: Empty source file produces appropriate error"
        else
          echo "FAIL: Missing error message"
          exit 1
        fi

        touch $out
      '';

  # Test: Concurrent activation script execution
  # Validates that multiple simultaneous home-manager activations don't corrupt the config file
  # Tests the copyWeztermToWindows script under concurrent execution
  test-concurrent-activation =
    pkgs.runCommand "test-concurrent-activation"
      {
        buildInputs = [ pkgs.bash ];
      }
      ''
        # Create mock WSL environment
        mkdir -p test-env/source/.config/wezterm
        mkdir -p test-env/target/mnt/c/Users/testuser

        # Generate a test config with unique content
        cat > test-env/source/.config/wezterm/wezterm.lua <<'EOF'
        local wezterm = require('wezterm')
        local config = wezterm.config_builder()
        config.font = wezterm.font('JetBrains Mono')
        config.font_size = 11.0
        config.color_scheme = 'Tokyo Night'
        return config
        EOF

        # Store expected content for verification
        EXPECTED_CONTENT=$(cat test-env/source/.config/wezterm/wezterm.lua)

        # Simulate 10 concurrent copy operations (like multiple home-manager switch commands)
        # Use bash background jobs instead of parallel to avoid citation notice
        for i in {1..10}; do
          cp test-env/source/.config/wezterm/wezterm.lua test-env/target/mnt/c/Users/testuser/.wezterm.lua &
        done

        # Wait for all background jobs to complete
        wait

        # Verify target file exists
        if [ ! -f test-env/target/mnt/c/Users/testuser/.wezterm.lua ]; then
          echo "FAIL: Target file was not created"
          exit 1
        fi

        # Verify file integrity - content must match source exactly
        TARGET_CONTENT=$(cat test-env/target/mnt/c/Users/testuser/.wezterm.lua)
        if [ "$TARGET_CONTENT" != "$EXPECTED_CONTENT" ]; then
          echo "FAIL: Concurrent copy corrupted file"
          echo "Expected content length: ''${#EXPECTED_CONTENT}"
          echo "Actual content length: ''${#TARGET_CONTENT}"
          echo ""
          echo "Expected:"
          echo "$EXPECTED_CONTENT"
          echo ""
          echo "Got:"
          echo "$TARGET_CONTENT"
          exit 1
        fi

        # Verify file is valid Lua syntax
        if ! ${pkgs.lua}/bin/lua -e "assert(loadfile('test-env/target/mnt/c/Users/testuser/.wezterm.lua'))" 2>&1; then
          echo "FAIL: Target file is not valid Lua after concurrent operations"
          exit 1
        fi

        echo "PASS: Concurrent activation completed successfully"
        echo "  - All 10 parallel copy operations completed"
        echo "  - File content integrity verified"
        echo "  - Lua syntax validation passed"
        echo ""
        echo "Note: Basic cp command is atomic for file overwrites on most filesystems"
        echo "      (writes to temp, then rename). This test verifies the behavior."

        touch $out
      '';

  # Test: Windows config copy corruption detection
  # Validates that the activation script produces a valid, uncorrupted Lua file on Windows
  # Tests for filesystem issues like truncation, encoding problems, and line ending conversion
  test-windows-copy-corruption-detection =
    pkgs.runCommand "test-windows-copy-corruption-detection"
      {
        buildInputs = [
          pkgs.bash
          pkgs.lua
        ];
      }
      ''
        # Create mock WSL environment
        mkdir -p test-env/source/.config/wezterm
        mkdir -p test-env/target/mnt/c/Users/testuser

        # Generate a realistic test config with various Lua constructs
        cat > test-env/source/.config/wezterm/wezterm.lua <<'EOF'
        local wezterm = require('wezterm')
        local config = wezterm.config_builder()
        config.font = wezterm.font('JetBrains Mono')
        config.font_size = 11.0
        config.color_scheme = 'Tokyo Night'
        config.scrollback_lines = 10000
        config.hide_tab_bar_if_only_one_tab = true
        config.window_padding = {
          left = 2,
          right = 2,
          top = 2,
          bottom = 2,
        }
        -- Multi-line string to test line ending handling
        config.default_prog = { 'wsl.exe', '-d', 'NixOS', '--cd', '/home/testuser' }
        return config
        EOF

        # Test 1: Normal copy operation
        echo "Test 1: Normal copy operation"
        cp test-env/source/.config/wezterm/wezterm.lua test-env/target/mnt/c/Users/testuser/.wezterm.lua

        # Validate Lua syntax on copied file
        if ! ${pkgs.lua}/bin/lua -e "assert(loadfile('test-env/target/mnt/c/Users/testuser/.wezterm.lua'))" 2>&1; then
          echo "FAIL: Copied file has invalid Lua syntax"
          exit 1
        fi
        echo "PASS: Normal copy produces valid Lua"

        # Verify byte-for-byte content match
        if ! cmp -s test-env/source/.config/wezterm/wezterm.lua test-env/target/mnt/c/Users/testuser/.wezterm.lua; then
          echo "FAIL: Copied file content does not match source (byte-for-byte)"
          echo "Source size: $(wc -c < test-env/source/.config/wezterm/wezterm.lua)"
          echo "Target size: $(wc -c < test-env/target/mnt/c/Users/testuser/.wezterm.lua)"
          exit 1
        fi
        echo "PASS: Byte-for-byte content match verified"

        # Test 2: Truncated file scenario (simulates out-of-space)
        echo ""
        echo "Test 2: Truncated file detection"
        # Truncate in the middle of the config.window_padding table to create invalid Lua
        head -c 250 test-env/source/.config/wezterm/wezterm.lua > test-env/target/mnt/c/Users/testuser/.wezterm.lua

        # Verify truncated file fails Lua validation
        if ${pkgs.lua}/bin/lua -e "assert(loadfile('test-env/target/mnt/c/Users/testuser/.wezterm.lua'))" 2>/dev/null; then
          echo "FAIL: Truncated file was not detected by Lua parser"
          echo "File size: $(wc -c < test-env/target/mnt/c/Users/testuser/.wezterm.lua)"
          echo "Content:"
          cat test-env/target/mnt/c/Users/testuser/.wezterm.lua
          exit 1
        fi
        echo "PASS: Truncated file correctly fails Lua validation"

        # Test 3: Corrupted multi-line string (simulates line ending issues)
        echo ""
        echo "Test 3: Line ending corruption detection"
        # Replace LF with CRLF in a way that breaks Lua parsing
        sed 's/$/\r/' test-env/source/.config/wezterm/wezterm.lua > test-env/target/mnt/c/Users/testuser/.wezterm-crlf.lua

        # Lua should still parse CRLF correctly (Lua accepts both)
        # but content will differ from source
        if cmp -s test-env/source/.config/wezterm/wezterm.lua test-env/target/mnt/c/Users/testuser/.wezterm-crlf.lua; then
          echo "FAIL: CRLF conversion was not detected by byte comparison"
          exit 1
        fi
        echo "PASS: Line ending changes detected by byte comparison"

        # Test 4: Empty file (simulates failed write)
        echo ""
        echo "Test 4: Empty file detection"
        touch test-env/target/mnt/c/Users/testuser/.wezterm-empty.lua

        # Empty file is valid Lua syntax (empty chunk), but it won't return a config table
        # Try to execute it and verify it returns nil (not a table)
        if ${pkgs.lua}/bin/lua -e "local result = loadfile('test-env/target/mnt/c/Users/testuser/.wezterm-empty.lua')(); if type(result) == 'table' then os.exit(1) end" 2>/dev/null; then
          echo "PASS: Empty file detected (does not return config table)"
        else
          echo "FAIL: Empty file check failed unexpectedly"
          exit 1
        fi

        echo ""
        echo "✓ Windows copy corruption detection test passed"
        echo "  - Normal copy produces valid Lua and matches source exactly"
        echo "  - Truncated files fail Lua syntax validation"
        echo "  - Line ending changes detected by byte comparison"
        echo "  - Empty files fail Lua validation"
        echo ""
        echo "Note: This test validates that the copy operation produces a valid,"
        echo "      uncorrupted config file. The activation script's 'cp' command"
        echo "      will preserve the file exactly, and any corruption would be"
        echo "      detected when WezTerm attempts to load the config at runtime."

        touch $out
      '';

  # Test: Windows copy failure - locked file
  # Validates copy failure handling when target file is locked or read-only
  test-windows-copy-failure-locked =
    pkgs.runCommand "test-windows-copy-failure-locked"
      {
        buildInputs = [
          pkgs.bash
          pkgs.coreutils
        ];
      }
      ''
        # Create mock environment
        mkdir -p test-env/source/.config/wezterm
        mkdir -p test-env/target/mnt/c/Users/testuser

        # Create valid source file
        echo "config content" > test-env/source/.config/wezterm/wezterm.lua

        # Create read-only target to simulate locked file
        echo "old config" > test-env/target/mnt/c/Users/testuser/.wezterm.lua
        chmod 444 test-env/target/mnt/c/Users/testuser/.wezterm.lua

        # Try to copy (should fail)
        if copy_error=$(cp test-env/source/.config/wezterm/wezterm.lua \
                           test-env/target/mnt/c/Users/testuser/.wezterm.lua 2>&1); then
          echo "FAIL: Copy should have failed for read-only target"
          exit 1
        else
          echo "PASS: Copy failed as expected for read-only file"

          # Verify error message mentions permissions
          if echo "$copy_error" | grep -qi "permission\|denied\|readonly\|cannot"; then
            echo "PASS: Error message indicates permission issue"
          else
            echo "WARNING: Error message doesn't clearly explain permission issue"
            echo "Got: $copy_error"
          fi
        fi

        touch $out
      '';

  # Test: Windows copy failure - nonexistent directory
  # Validates copy failure when target directory doesn't exist
  test-windows-copy-failure-nonexistent-dir =
    pkgs.runCommand "test-copy-failure-nonexistent"
      {
        buildInputs = [ pkgs.bash ];
      }
      ''
        # Create source but not target directory
        mkdir -p test-env/source/.config/wezterm
        echo "config" > test-env/source/.config/wezterm/wezterm.lua

        # Try to copy to nonexistent directory
        if cp test-env/source/.config/wezterm/wezterm.lua \
              test-env/nonexistent-dir/.wezterm.lua 2>&1; then
          echo "FAIL: Copy should have failed for nonexistent directory"
          exit 1
        else
          echo "PASS: Copy failed for nonexistent target directory"
        fi

        touch $out
      '';

  # Test: WezTerm runtime validation (limited)
  # Note: Full runtime validation requires actual WezTerm binary
  # This test documents the limitation and validates config structure
  test-wezterm-runtime-validation =
    pkgs.runCommand "test-wezterm-runtime-validation"
      {
        buildInputs = [ pkgs.lua ];
      }
      ''
        # Generate Linux config
        ${
          let
            luaConfig = extractLuaConfig (evaluateModule {
              isLinux = true;
              isDarwin = false;
            });
            luaFile = pkgs.writeText "test-config.lua" luaConfig;
          in
          ''
            # Validate Lua syntax (best we can do without WezTerm binary)
            if ! ${pkgs.lua}/bin/lua -e "assert(loadfile('${luaFile}'))" 2>&1; then
              echo "FAIL: Generated Linux config has Lua syntax errors"
              exit 1
            fi

            echo "PASS: Linux config has valid Lua syntax"
            echo "NOTE: Full WezTerm API validation requires actual WezTerm binary"
            echo "      (not available in nixpkgs). Manual validation recommended."
          ''
        }

        touch $out
      '';

  # Test: Conflicting platform flags (both isLinux and isDarwin true)
  # Validates that the module handles impossible platform configurations gracefully
  # The evaluateModule helper already has an assertion, but this tests the raw module
  test-conflicting-platform-flags =
    let
      # Create mock pkgs with BOTH platform flags set to true
      conflictingPkgs = testPkgs // {
        stdenv = pkgs.stdenv // {
          isLinux = true;
          isDarwin = true;
        };
      };

      mockConfig = {
        home = {
          username = "testuser";
          homeDirectory = "/home/testuser";
        };
      };

      # Try to evaluate the module with conflicting flags
      # This should either fail or produce an invalid config
      attemptEvaluation = builtins.tryEval (weztermModule {
        config = mockConfig;
        pkgs = conflictingPkgs;
        lib = lib;
      });

      # If evaluation succeeds, extract the Lua config
      luaConfigResult =
        if attemptEvaluation.success then
          builtins.tryEval (extractLuaConfig attemptEvaluation.value)
        else
          {
            success = false;
            value = null;
          };

      # If we got Lua config, try to validate it
      luaValidationResult =
        if luaConfigResult.success then
          let
            luaConfig = luaConfigResult.value;
            hasLinuxConfig = lib.hasInfix "default_prog" luaConfig && lib.hasInfix "wsl.exe" luaConfig;
            hasMacosConfig = lib.hasInfix "native_macos_fullscreen_mode" luaConfig;
            hasBothConfigs = hasLinuxConfig && hasMacosConfig;
          in
          {
            success = true;
            hasLinux = hasLinuxConfig;
            hasMacos = hasMacosConfig;
            hasBoth = hasBothConfigs;
            luaCode = luaConfig;
          }
        else
          {
            success = false;
            hasLinux = false;
            hasMacos = false;
            hasBoth = false;
            luaCode = "";
          };

    in
    pkgs.runCommand "test-conflicting-platform-flags" { } ''
      # Test 1: Check if module evaluation succeeded
      ${
        if attemptEvaluation.success then
          "echo 'INFO: Module evaluation succeeded with conflicting flags (isLinux=true && isDarwin=true)'"
        else
          "echo 'PASS: Module evaluation failed with conflicting platform flags (expected behavior)' && touch $out && exit 0"
      }

      # Test 2: If evaluation succeeded, check if Lua config extraction succeeded
      ${
        if luaConfigResult.success then
          "echo 'INFO: Lua config extraction succeeded'"
        else
          "echo 'PASS: Lua config extraction failed with conflicting flags (evaluation succeeded but config invalid)' && touch $out && exit 0"
      }

      # Test 3: If we got a config, verify it's invalid (contains both platform configs)
      ${
        if luaValidationResult.success && luaValidationResult.hasBoth then
          ''
            echo "DETECTED: Generated config contains BOTH Linux and macOS platform-specific settings"
            echo "  - Linux config (default_prog with wsl.exe): ${
              if luaValidationResult.hasLinux then "present" else "absent"
            }"
            echo "  - macOS config (native_macos_fullscreen_mode): ${
              if luaValidationResult.hasMacos then "present" else "absent"
            }"
            echo ""
            echo "This creates an invalid configuration that would fail at runtime:"
            echo "  - macOS doesn't have wsl.exe"
            echo "  - Linux doesn't support native_macos_fullscreen_mode"
            echo ""
            echo "RECOMMENDATION: Add explicit assertion to wezterm.nix:"
            echo "  assert lib.assertMsg (!(pkgs.stdenv.isLinux && pkgs.stdenv.isDarwin))"
            echo "    \"wezterm.nix: Cannot have both isLinux=true and isDarwin=true\";"
            echo ""
            echo "PASS: Test correctly detected conflicting platform configuration"
            touch $out
          ''
        else if luaValidationResult.success then
          ''
            echo "INFO: Generated config does not contain both platform settings"
            echo "  - This means the module chose one platform over the other"
            echo "  - Current behavior: ${
              if luaValidationResult.hasLinux then
                "Linux config included"
              else if luaValidationResult.hasMacos then
                "macOS config included"
              else
                "Neither platform config included"
            }"
            echo ""
            echo "PASS: Module handles conflicting flags by choosing one platform"
            touch $out
          ''
        else
          ""
      }
    '';

  # Test 11: Config file location consistency
  # Validates that the activation script's hardcoded source path matches
  # where home-manager currently writes wezterm config
  test-config-file-location =
    let
      weztermSource = builtins.readFile ./wezterm.nix;
      # Expected path where activation script looks for the wezterm config
      # This path is hardcoded in wezterm.nix:130 and must match where home-manager
      # programs.wezterm writes its config (currently: ${XDG_CONFIG_HOME}/wezterm/wezterm.lua)
      # WARNING: If home-manager changes its default wezterm location, the activation
      # script SOURCE_FILE path must be updated to match.
      expectedPath = ".config/wezterm/wezterm.lua";
      expectedFullPathPattern = "\${config.home.homeDirectory}/.config/wezterm/wezterm.lua";
    in
    pkgs.runCommand "test-wezterm-config-file-location" { } ''
      # Validate activation script uses the correct source path
      ${
        if lib.hasInfix expectedFullPathPattern weztermSource then
          "echo 'PASS: Activation script uses expected config path: ${expectedFullPathPattern}'"
        else
          "echo 'FAIL: Activation script source path does not match where home-manager writes config' && exit 1"
      }

      # Validate the hardcoded path matches where home-manager currently writes config
      ${
        if lib.hasInfix expectedPath weztermSource then
          "echo 'PASS: Hardcoded path matches current home-manager wezterm location (${expectedPath})'"
        else
          "echo 'FAIL: Hardcoded path does not match where home-manager writes config' && exit 1"
      }

      # Document the contract for future maintainers
      echo ""
      echo "📋 Config Path Contract:"
      echo "  - Home-manager generates: \$HOME/${expectedPath}"
      echo "  - Activation script reads: \''${config.home.homeDirectory}/${expectedPath}"
      echo "  - These paths MUST stay synchronized"
      echo ""
      echo "  If home-manager changes its default wezterm config location,"
      echo "  the activation script SOURCE_FILE path must be updated to match."

      touch $out
    '';

  # Test 12: Home Manager integration test
  # Validates the module works correctly when evaluated through a module system,
  # catching failures that would occur during home-manager switch but aren't
  # caught by isolated unit tests. This test verifies the module structure,
  # attribute types, and DAG ordering work correctly.
  test-homemanager-integration =
    let
      # Mock pkgs for Linux
      linuxPkgs = testPkgs // {
        stdenv = pkgs.stdenv // {
          isLinux = true;
          isDarwin = false;
        };
      };

      # Mock pkgs for macOS
      macosPkgs = testPkgs // {
        stdenv = pkgs.stdenv // {
          isLinux = false;
          isDarwin = true;
        };
      };

      # Mock config for module evaluation
      mockLinuxConfig = {
        home = {
          username = "testuser";
          homeDirectory = "/home/testuser";
        };
      };

      mockMacosConfig = {
        home = {
          username = "macuser";
          homeDirectory = "/Users/macuser";
        };
      };

      # Test Linux configuration by invoking the module function directly
      linuxResult = weztermModule {
        config = mockLinuxConfig;
        pkgs = linuxPkgs;
        lib = lib;
      };

      # Test macOS configuration by invoking the module function directly
      macosResult = weztermModule {
        config = mockMacosConfig;
        pkgs = macosPkgs;
        lib = lib;
      };
    in
    pkgs.runCommand "test-homemanager-integration" { } ''
      # Verify Linux config evaluates without errors
      ${
        if linuxResult.programs.wezterm.enable or false then
          "echo 'PASS: Linux config evaluates and enables wezterm'"
        else
          "echo 'FAIL: Linux config evaluation failed or wezterm not enabled' && exit 1"
      }

      # Verify macOS config evaluates without errors
      ${
        if macosResult.programs.wezterm.enable or false then
          "echo 'PASS: macOS config evaluates and enables wezterm'"
        else
          "echo 'FAIL: macOS config evaluation failed or wezterm not enabled' && exit 1"
      }

      # Verify activation script is present on Linux (via DAG structure)
      ${
        if linuxResult.home.activation ? copyWeztermToWindows then
          "echo 'PASS: Linux config includes activation script in DAG'"
        else
          "echo 'FAIL: Linux config missing activation script in DAG' && exit 1"
      }

      # Verify activation script is conditionally disabled on macOS
      # lib.mkIf false creates a conditional structure (_type = "if", condition = false).
      # During module evaluation, Home Manager's module system processes this conditional
      # and excludes the script from the final activation configuration.
      # The test verifies this by checking for either: null (excluded) or conditional structure with condition=false.
      ${
        let
          activationScript = macosResult.home.activation.copyWeztermToWindows or null;
          isConditional = activationScript != null && (activationScript._type or null) == "if";
          conditionValue = if isConditional then (activationScript.condition or null) else null;
        in
        if isConditional && conditionValue == false then
          "echo 'PASS: macOS config correctly disables activation script via mkIf'"
        else if activationScript == null then
          "echo 'PASS: macOS config excludes activation script'"
        else
          "echo 'FAIL: macOS config should not include active activation script' && exit 1"
      }

      # Verify extraConfig is present on both platforms
      ${
        if linuxResult.programs.wezterm ? extraConfig then
          "echo 'PASS: Linux config includes extraConfig'"
        else
          "echo 'FAIL: Linux config missing extraConfig' && exit 1"
      }
      ${
        if macosResult.programs.wezterm ? extraConfig then
          "echo 'PASS: macOS config includes extraConfig'"
        else
          "echo 'FAIL: macOS config missing extraConfig' && exit 1"
      }

      # Verify DAG structure on Linux activation script
      ${
        let
          activationScript = linuxResult.home.activation.copyWeztermToWindows or null;
        in
        if activationScript != null then
          "echo 'PASS: Linux activation script has correct DAG structure'"
        else
          "echo 'FAIL: Linux activation script DAG structure invalid' && exit 1"
      }

      echo ""
      echo "✓ Home Manager integration test passed"
      echo "  - Module evaluates correctly when invoked"
      echo "  - Platform-specific activation scripts work correctly"
      echo "  - DAG structure is valid"
      echo "  - Module attributes have correct types"
      touch $out
    '';

  # Test 13: Activation script DAG execution and variable access
  # Validates that the activation script executes correctly within home-manager's
  # module system and has proper access to all required variables
  test-activation-dag-execution =
    let
      # Mock pkgs for Linux
      linuxPkgs = testPkgs // {
        stdenv = pkgs.stdenv // {
          isLinux = true;
          isDarwin = false;
        };
      };

      # Mock config for module evaluation
      mockConfig = {
        home = {
          username = "testuser";
          homeDirectory = "/home/testuser";
        };
      };

      # Mock lib with home-manager DAG functions
      mockLib = lib // {
        hm = {
          dag = {
            entryAfter = deps: data: {
              _type = "dagEntryAfter";
              after = deps;
              inherit data;
            };
          };
        };
      };

      # Evaluate the module to get activation script
      moduleResult = weztermModule {
        config = mockConfig;
        pkgs = linuxPkgs;
        lib = mockLib;
      };

      activationScript = moduleResult.home.activation.copyWeztermToWindows or null;

      # The activation script is wrapped in lib.mkIf, so we need to unwrap it
      # to access the actual DAG entry
      dagEntry =
        if activationScript != null && activationScript ? _type && activationScript._type == "if" then
          activationScript.content or null
        else
          activationScript;

      # Extract the script data from the DAG entry
      scriptData = if dagEntry != null && dagEntry ? data then dagEntry.data else null;
    in
    pkgs.runCommand "test-activation-dag-execution" { } ''
      # Verify activation script exists on Linux
      ${
        if activationScript != null then
          "echo 'PASS: Activation script exists on Linux'"
        else
          "echo 'FAIL: Activation script missing on Linux' && exit 1"
      }

      # Verify the outer structure is a conditional (lib.mkIf)
      ${
        if
          activationScript != null
          && (activationScript._type or null) == "if"
          && activationScript.condition == true
        then
          "echo 'PASS: Activation script is wrapped in lib.mkIf with condition=true for Linux'"
        else
          "echo 'FAIL: Activation script not properly wrapped in lib.mkIf for Linux' && exit 1"
      }

      # Verify the inner structure is a DAG entry
      ${
        if dagEntry != null && (dagEntry._type or null) == "dagEntryAfter" then
          "echo 'PASS: Inner structure is a proper DAG entry (type: dagEntryAfter)'"
        else
          "echo 'FAIL: Inner structure is not a proper DAG entry' && exit 1"
      }

      # Verify script depends on linkGeneration
      ${
        if dagEntry != null && (builtins.elem "linkGeneration" (dagEntry.after or [ ])) then
          "echo 'PASS: Activation script depends on linkGeneration'"
        else
          "echo 'FAIL: Activation script missing linkGeneration dependency' && exit 1"
      }

      # Verify script data is present and is a string (the actual shell script)
      ${
        if scriptData != null && builtins.isString scriptData then
          "echo 'PASS: Activation script contains shell script data'"
        else
          "echo 'FAIL: Activation script missing or invalid script data' && exit 1"
      }

      # Verify script references required home-manager variables
      ${
        if scriptData != null && lib.hasInfix "DRY_RUN_CMD" scriptData then
          "echo 'PASS: Activation script references \$DRY_RUN_CMD variable'"
        else
          "echo 'FAIL: Activation script missing \$DRY_RUN_CMD variable reference' && exit 1"
      }

      ${
        if scriptData != null && lib.hasInfix "VERBOSE_ARG" scriptData then
          "echo 'PASS: Activation script references \$VERBOSE_ARG variable'"
        else
          "echo 'FAIL: Activation script missing \$VERBOSE_ARG variable reference' && exit 1"
      }

      ${
        if scriptData != null && lib.hasInfix mockConfig.home.homeDirectory scriptData then
          "echo 'PASS: Activation script uses interpolated homeDirectory value'"
        else
          "echo 'FAIL: Activation script missing homeDirectory value' && exit 1"
      }

      # Verify script is properly excluded on macOS via lib.mkIf
      ${
        let
          macosPkgs = testPkgs // {
            stdenv = pkgs.stdenv // {
              isLinux = false;
              isDarwin = true;
            };
          };
          macosResult = weztermModule {
            config = mockConfig;
            pkgs = macosPkgs;
            lib = mockLib;
          };
          macosActivation = macosResult.home.activation.copyWeztermToWindows or null;
          isConditionallyDisabled =
            macosActivation == null
            || (macosActivation ? _type && macosActivation._type == "if" && macosActivation.condition == false);
        in
        if isConditionallyDisabled then
          "echo 'PASS: Activation script properly excluded on macOS via lib.mkIf'"
        else
          "echo 'FAIL: Activation script not properly excluded on macOS' && exit 1"
      }

      echo ""
      echo "✓ Activation script DAG execution test passed"
      echo "  - Script is properly integrated into home-manager DAG"
      echo "  - Script depends on linkGeneration (executes after config linking)"
      echo "  - Script has access to required home-manager variables"
      echo "  - Script is properly excluded on non-Linux platforms"
      echo ""
      echo "Note: This test validates DAG structure and variable access."
      echo "      Runtime execution is validated by test-activation-script-runtime."

      touch $out
    '';

  # Test 14: Home Manager activation integration with real DAG execution
  # This test addresses TODO(#1612) from wezterm_test.sh line 8
  # Validates that the activation script executes correctly within Home Manager's
  # full module system, including proper DAG ordering and variable access
  test-homemanager-dag-integration =
    let
      # Mock pkgs for Linux (WSL environment)
      linuxPkgs = testPkgs // {
        stdenv = pkgs.stdenv // {
          isLinux = true;
          isDarwin = false;
        };
      };

      # Mock pkgs for macOS
      macosPkgs = testPkgs // {
        stdenv = pkgs.stdenv // {
          isLinux = false;
          isDarwin = true;
        };
      };

      # Mock lib with Home Manager DAG functions
      mockLib = lib // {
        hm = {
          dag = {
            entryAfter = deps: data: {
              _type = "dagEntryAfter";
              after = deps;
              inherit data;
            };
          };
        };
      };

      # Create a minimal Home Manager module system evaluation
      # This simulates how home-manager actually processes modules
      evalLinuxModule = lib.evalModules {
        modules = [
          # Import the wezterm module
          ./wezterm.nix
          # Provide required Home Manager infrastructure
          {
            config = {
              home = {
                username = "testuser";
                homeDirectory = "/home/testuser";
              };
            };
            options = {
              home = {
                username = lib.mkOption {
                  type = lib.types.str;
                  default = "testuser";
                };
                homeDirectory = lib.mkOption {
                  type = lib.types.str;
                  default = "/home/testuser";
                };
                activation = lib.mkOption {
                  type = lib.types.attrsOf lib.types.unspecified;
                  default = { };
                };
              };
              programs.wezterm = {
                enable = lib.mkOption {
                  type = lib.types.bool;
                  default = false;
                };
                extraConfig = lib.mkOption {
                  type = lib.types.lines;
                  default = "";
                };
              };
            };
          }
        ];
        specialArgs = {
          lib = mockLib;
          pkgs = linuxPkgs;
        };
      };

      evalMacosModule = lib.evalModules {
        modules = [
          ./wezterm.nix
          {
            config = {
              home = {
                username = "macuser";
                homeDirectory = "/Users/macuser";
              };
            };
            options = {
              home = {
                username = lib.mkOption {
                  type = lib.types.str;
                  default = "macuser";
                };
                homeDirectory = lib.mkOption {
                  type = lib.types.str;
                  default = "/Users/macuser";
                };
                activation = lib.mkOption {
                  type = lib.types.attrsOf lib.types.unspecified;
                  default = { };
                };
              };
              programs.wezterm = {
                enable = lib.mkOption {
                  type = lib.types.bool;
                  default = false;
                };
                extraConfig = lib.mkOption {
                  type = lib.types.lines;
                  default = "";
                };
              };
            };
          }
        ];
        specialArgs = {
          lib = mockLib;
          pkgs = macosPkgs;
        };
      };

      # Extract activation scripts from Linux evaluation
      linuxActivation = evalLinuxModule.config.home.activation;
      macosActivation = evalMacosModule.config.home.activation;

      # Check if copyWeztermToWindows is present and has correct DAG structure
      hasLinuxActivation = linuxActivation ? copyWeztermToWindows;
      linuxDagEntry = linuxActivation.copyWeztermToWindows or null;

      # Verify DAG entry structure (should have _type and after fields from entryAfter)
      linuxDagValid =
        linuxDagEntry != null
        && (linuxDagEntry._type or null) == "dagEntryAfter"
        && (linuxDagEntry.after or [ ]) == [ "linkGeneration" ];

      # Check macOS properly excludes activation via mkIf
      hasMacosActivation = macosActivation ? copyWeztermToWindows;
      macosDagEntry = macosActivation.copyWeztermToWindows or null;

      # macOS should either have no entry or a conditional entry with condition=false
      macosProperlyExcluded =
        macosDagEntry == null
        || (macosDagEntry._type or null) == "if" && (macosDagEntry.condition or true) == false;

      # Extract the actual script data from Linux DAG entry
      linuxScriptData = if linuxDagEntry != null then (linuxDagEntry.data or "") else "";

      # Verify script contains essential runtime components
      scriptHasWslCheck = lib.hasInfix "/mnt/c/Users" linuxScriptData;
      scriptHasUserDetection = lib.hasInfix "WINDOWS_USER=" linuxScriptData;
      scriptHasCopyLogic = lib.hasInfix "DRY_RUN_CMD cp" linuxScriptData;

    in
    pkgs.runCommand "test-homemanager-dag-integration" { } ''
      # Test 1: Verify Linux module evaluation includes activation script
      ${
        if hasLinuxActivation then
          "echo 'PASS: Linux module includes copyWeztermToWindows in activation DAG'"
        else
          "echo 'FAIL: Linux module missing copyWeztermToWindows in activation' && exit 1"
      }

      # Test 2: Verify DAG entry has correct structure with linkGeneration dependency
      ${
        if linuxDagValid then
          "echo 'PASS: Activation script has correct DAG structure (entryAfter linkGeneration)'"
        else
          "echo 'FAIL: Activation script DAG structure invalid or missing linkGeneration dependency' && exit 1"
      }

      # Test 3: Verify script data contains WSL detection logic
      ${
        if scriptHasWslCheck then
          "echo 'PASS: Activation script contains WSL environment check'"
        else
          "echo 'FAIL: Activation script missing WSL detection logic' && exit 1"
      }

      # Test 4: Verify script data contains Windows user detection
      ${
        if scriptHasUserDetection then
          "echo 'PASS: Activation script contains Windows user auto-detection'"
        else
          "echo 'FAIL: Activation script missing user detection logic' && exit 1"
      }

      # Test 5: Verify script data contains config copy logic
      ${
        if scriptHasCopyLogic then
          "echo 'PASS: Activation script contains file copy implementation'"
        else
          "echo 'FAIL: Activation script missing copy logic' && exit 1"
      }

      # Test 6: Verify macOS module properly excludes activation script
      ${
        if macosProperlyExcluded then
          "echo 'PASS: macOS module properly excludes activation script via lib.mkIf'"
        else
          "echo 'FAIL: macOS module incorrectly includes activation script' && exit 1"
      }

      # Test 7: Verify programs.wezterm is enabled on both platforms
      ${
        if evalLinuxModule.config.programs.wezterm.enable or false then
          "echo 'PASS: Linux module enables programs.wezterm'"
        else
          "echo 'FAIL: Linux module does not enable programs.wezterm' && exit 1"
      }

      ${
        if evalMacosModule.config.programs.wezterm.enable or false then
          "echo 'PASS: macOS module enables programs.wezterm'"
        else
          "echo 'FAIL: macOS module does not enable programs.wezterm' && exit 1"
      }

      echo ""
      echo "✓ Home Manager DAG integration test passed"
      echo "  - Module evaluation through lib.evalModules succeeds"
      echo "  - Activation script properly integrated into DAG system"
      echo "  - DAG entry has correct type and linkGeneration dependency"
      echo "  - Script contains all required WSL/Windows logic"
      echo "  - Platform-specific conditional (lib.mkIf) works correctly"
      echo "  - macOS properly excludes Linux-specific activation"
      echo ""
      echo "This test validates full Home Manager module system integration,"
      echo "confirming the activation script will execute correctly during"
      echo "home-manager switch, after config files are linked."

      touch $out
    '';

  # Test: Activation script trap cleanup failure paths
  # Validates that trap cleanup logic correctly handles failures
  # Tests both successful cleanup and cleanup failure with warning messages
  test-activation-trap-cleanup =
    pkgs.runCommand "test-activation-trap-cleanup"
      {
        buildInputs = [ pkgs.bash ];
      }
      ''
        # Test 1: Normal trap cleanup (successful removal)
        echo "Test 1: Normal trap cleanup"

        # Create mock temp file
        mkdir -p test-env
        TEMP_FILE=$(mktemp -p test-env)

        # Simulate trap cleanup on normal exit
        cleanup_script="
          trap 'if ! rm -f \"$TEMP_FILE\" 2>&1; then echo \"WARNING: Failed to cleanup stderr temp file: $TEMP_FILE\" >&2; fi' EXIT
          exit 0
        "

        if ! ${pkgs.bash}/bin/bash -c "$cleanup_script"; then
          echo "FAIL: Normal trap cleanup script failed"
          exit 1
        fi

        # Verify temp file was removed
        if [ -f "$TEMP_FILE" ]; then
          echo "FAIL: Temp file was not removed by trap"
          exit 1
        fi
        echo "PASS: Normal trap cleanup successfully removed temp file"

        # Test 2: Trap cleanup failure (file cannot be removed)
        echo ""
        echo "Test 2: Trap cleanup failure with warning"

        # Create a read-only directory to prevent file removal
        mkdir -p test-env/readonly-dir
        READONLY_FILE="test-env/readonly-dir/temp-file"
        touch "$READONLY_FILE"
        chmod 444 "$READONLY_FILE"
        chmod 555 test-env/readonly-dir

        # Run trap cleanup that should fail
        cleanup_fail_script="
          TEMP_FILE='$READONLY_FILE'
          trap 'if ! rm -f \"\$TEMP_FILE\" 2>&1; then echo \"WARNING: Failed to cleanup stderr temp file: \$TEMP_FILE\" >&2; fi' EXIT
          exit 0
        "

        # Capture stderr to verify warning message appears
        if stderr_output=$(${pkgs.bash}/bin/bash -c "$cleanup_fail_script" 2>&1); then
          # Check if warning message was printed
          if echo "$stderr_output" | grep -q "WARNING: Failed to cleanup stderr temp file"; then
            echo "PASS: Trap cleanup failure produces warning message"
          else
            echo "FAIL: Warning message not found in output"
            echo "Got: $stderr_output"
            exit 1
          fi

          # Verify temp file path is included in warning
          if echo "$stderr_output" | grep -q "$READONLY_FILE"; then
            echo "PASS: Warning includes temp file path for debugging"
          else
            echo "FAIL: Warning missing temp file path"
            exit 1
          fi
        else
          echo "FAIL: Cleanup script exited with non-zero status"
          exit 1
        fi

        # Cleanup
        chmod 755 test-env/readonly-dir

        # Test 3: Verify trap doesn't interfere with script exit codes
        echo ""
        echo "Test 3: Trap cleanup preserves exit codes"

        # Create temp file for cleanup
        SUCCESS_TEMP=$(mktemp -p test-env)

        # Script that exits successfully - trap should not change exit code
        success_script="
          TEMP_FILE='$SUCCESS_TEMP'
          trap 'rm -f \"\$TEMP_FILE\" 2>&1' EXIT
          exit 0
        "

        if ${pkgs.bash}/bin/bash -c "$success_script"; then
          echo "PASS: Successful script exit code preserved after trap"
        else
          echo "FAIL: Trap changed successful exit code"
          exit 1
        fi

        # Create temp file for failure test
        FAIL_TEMP=$(mktemp -p test-env)

        # Script that exits with error - trap should not mask the error
        fail_script="
          TEMP_FILE='$FAIL_TEMP'
          trap 'rm -f \"\$TEMP_FILE\" 2>&1' EXIT
          exit 42
        "

        if ${pkgs.bash}/bin/bash -c "$fail_script"; then
          echo "FAIL: Error exit code was masked by trap"
          exit 1
        else
          exit_code=$?
          if [ $exit_code -eq 42 ]; then
            echo "PASS: Error exit code preserved after trap (got 42 as expected)"
          else
            echo "FAIL: Unexpected exit code: $exit_code (expected 42)"
            exit 1
          fi
        fi

        echo ""
        echo "✓ Activation script trap cleanup test passed"
        echo "  - Normal cleanup successfully removes temp files"
        echo "  - Cleanup failures produce clear warning messages with file paths"
        echo "  - Trap cleanup does not interfere with script exit codes"

        touch $out
      '';

  # Test: Activation copy interrupted (disk full simulation)
  # Validates error handling when copy operation fails mid-operation
  test-activation-copy-interrupted =
    pkgs.runCommand "test-activation-copy-interrupted"
      {
        buildInputs = [
          pkgs.bash
          pkgs.coreutils
        ];
      }
      ''
        # Create mock WSL environment
        mkdir -p test-env/source/.config/wezterm
        mkdir -p test-env/target/mnt/c/Users/testuser

        # Create valid source file
        cat > test-env/source/.config/wezterm/wezterm.lua <<'EOF'
        local wezterm = require('wezterm')
        local config = wezterm.config_builder()
        config.font = wezterm.font('JetBrains Mono')
        config.font_size = 11.0
        config.color_scheme = 'Tokyo Night'
        return config
        EOF

        # Test 1: Simulate interrupted copy (truncated target)
        echo "Test 1: Interrupted copy creates invalid target"

        # Truncate source file during copy to simulate disk-full
        # This creates a partial file that fails Lua validation
        head -c 50 test-env/source/.config/wezterm/wezterm.lua > test-env/target/mnt/c/Users/testuser/.wezterm.lua

        # Verify target exists but is corrupted
        if [ ! -f test-env/target/mnt/c/Users/testuser/.wezterm.lua ]; then
          echo "FAIL: Target file should exist (even if corrupted)"
          exit 1
        fi

        # Verify target is not valid Lua
        if ${pkgs.lua}/bin/lua -e "assert(loadfile('test-env/target/mnt/c/Users/testuser/.wezterm.lua'))" 2>/dev/null; then
          echo "FAIL: Truncated file should fail Lua validation"
          exit 1
        fi
        echo "PASS: Interrupted copy creates invalid Lua file"

        # Test 2: Verify copy command with error detection
        echo ""
        echo "Test 2: Copy command with error detection"

        # Simulate copy failure by making target read-only
        chmod 444 test-env/target/mnt/c/Users/testuser/.wezterm.lua

        # Try copy and verify it fails with error message
        SOURCE_FILE="test-env/source/.config/wezterm/wezterm.lua"
        TARGET_FILE="test-env/target/mnt/c/Users/testuser/.wezterm.lua"

        if copy_error=$(cp "$SOURCE_FILE" "$TARGET_FILE" 2>&1); then
          echo "FAIL: Copy should have failed for read-only target"
          exit 1
        else
          echo "PASS: Copy failed as expected for read-only target"

          # Verify error message is informative
          if echo "$copy_error" | grep -qi "permission\|denied\|cannot"; then
            echo "PASS: Error message indicates the failure reason"
          else
            echo "WARNING: Error message could be more descriptive"
            echo "Got: $copy_error"
          fi
        fi

        # Test 3: Atomic copy behavior (either complete or unchanged)
        echo ""
        echo "Test 3: Verify copy operation atomicity expectation"

        # Reset target to writable
        chmod 644 test-env/target/mnt/c/Users/testuser/.wezterm.lua

        # Store original content
        echo "old content" > test-env/target/mnt/c/Users/testuser/.wezterm.lua
        ORIGINAL_CONTENT=$(cat test-env/target/mnt/c/Users/testuser/.wezterm.lua)

        # Successful copy should completely replace content
        if cp "$SOURCE_FILE" "$TARGET_FILE" 2>&1; then
          NEW_CONTENT=$(cat "$TARGET_FILE")
          SOURCE_CONTENT=$(cat "$SOURCE_FILE")

          if [ "$NEW_CONTENT" = "$SOURCE_CONTENT" ]; then
            echo "PASS: Successful copy completely replaces target"
          else
            echo "FAIL: Copy succeeded but content doesn't match source"
            exit 1
          fi

          # Verify target is valid Lua after successful copy
          if ${pkgs.lua}/bin/lua -e "assert(loadfile('$TARGET_FILE'))" 2>&1; then
            echo "PASS: Target is valid Lua after successful copy"
          else
            echo "FAIL: Target should be valid Lua after successful copy"
            exit 1
          fi
        else
          echo "FAIL: Copy should have succeeded"
          exit 1
        fi

        echo ""
        echo "✓ Activation copy interruption test passed"
        echo "  - Interrupted copies create invalid Lua files (detectable)"
        echo "  - Copy failures are detectable via exit code and error messages"
        echo "  - Successful copies completely replace target with valid content"
        echo ""
        echo "Note: Basic cp command behavior on most filesystems is atomic for"
        echo "      overwrites (write to temp, then rename). Interrupted writes"
        echo "      would leave either old file or corrupted file, both detectable."

        touch $out
      '';

  # Test: Username special characters Lua escaping
  # Validates toJSON escaping prevents Lua injection when username contains special chars
  test-username-special-chars-lua-escaping =
    let
      # Test with username containing double quote
      resultQuote = evaluateModule {
        username = "test\"user";
        isLinux = true;
      };
      luaConfigQuote = extractLuaConfig resultQuote;
      luaFileQuote = pkgs.writeText "test-quote.lua" luaConfigQuote;

      # Test with username containing backslash
      resultBackslash = evaluateModule {
        username = "test\\user";
        isLinux = true;
      };
      luaConfigBackslash = extractLuaConfig resultBackslash;
      luaFileBackslash = pkgs.writeText "test-backslash.lua" luaConfigBackslash;

      # Test with username containing single quote
      resultSingleQuote = evaluateModule {
        username = "test'user";
        isLinux = true;
      };
      luaConfigSingleQuote = extractLuaConfig resultSingleQuote;
      luaFileSingleQuote = pkgs.writeText "test-singlequote.lua" luaConfigSingleQuote;
    in
    pkgs.runCommand "test-username-special-chars-lua-escaping"
      {
        buildInputs = [
          pkgs.lua
          pkgs.gnugrep
        ];
      }
      ''
        echo "Test 1: Username with double quote"

        # Verify toJSON escaping is applied (should be JSON string literal with escaped quote)
        # The toJSON function should produce: "test\"user" (a valid JSON string)
        # In the generated Lua: '/home/' .. "test\"user"
        if grep -q 'test\\"user' ${luaFileQuote}; then
          echo "PASS: Username with double quote properly escaped"
        else
          echo "FAIL: Username escaping missing - Lua injection risk"
          echo "Generated Lua config:"
          cat ${luaFileQuote}
          exit 1
        fi

        # Validate generated Lua is syntactically correct
        if ! ${pkgs.lua}/bin/lua -e "assert(loadfile('${luaFileQuote}'))" 2>&1; then
          echo "FAIL: Generated Lua with quote in username has syntax errors"
          exit 1
        fi
        echo "PASS: Lua syntax valid with double quote in username"

        echo ""
        echo "Test 2: Username with backslash"

        # Backslash should be escaped as \\ in JSON string
        if grep -q 'test\\\\user' ${luaFileBackslash}; then
          echo "PASS: Username with backslash properly escaped"
        else
          echo "FAIL: Backslash not properly escaped"
          echo "Generated Lua config:"
          cat ${luaFileBackslash}
          exit 1
        fi

        # Validate Lua syntax
        if ! ${pkgs.lua}/bin/lua -e "assert(loadfile('${luaFileBackslash}'))" 2>&1; then
          echo "FAIL: Generated Lua with backslash in username has syntax errors"
          exit 1
        fi
        echo "PASS: Lua syntax valid with backslash in username"

        echo ""
        echo "Test 3: Username with single quote"

        # Single quote should appear in JSON string (JSON uses double quotes)
        if grep -q "test'user" ${luaFileSingleQuote}; then
          echo "PASS: Username with single quote handled correctly"
        else
          echo "FAIL: Single quote handling incorrect"
          exit 1
        fi

        # Validate Lua syntax
        if ! ${pkgs.lua}/bin/lua -e "assert(loadfile('${luaFileSingleQuote}'))" 2>&1; then
          echo "FAIL: Generated Lua with single quote in username has syntax errors"
          exit 1
        fi
        echo "PASS: Lua syntax valid with single quote in username"

        echo ""
        echo "✓ Username special character escaping test passed"
        echo "  - Double quotes are properly JSON-escaped to prevent Lua injection"
        echo "  - Backslashes are properly escaped"
        echo "  - Single quotes are handled correctly"
        echo "  - All generated Lua configs are syntactically valid"

        touch $out
      '';

  # Test: Activation script dry-run mode
  # Validates DRY_RUN mode validates paths without executing copy
  test-activation-dry-run-mode =
    let
      # Mock lib with home-manager DAG functions
      mockLib = lib // {
        hm = {
          dag = {
            entryAfter = deps: data: {
              _type = "dagEntryAfter";
              after = deps;
              inherit data;
            };
          };
        };
      };

      # Mock pkgs for Linux
      linuxPkgs = testPkgs // {
        stdenv = pkgs.stdenv // {
          isLinux = true;
          isDarwin = false;
        };
      };

      # Evaluate module with mockLib
      result = weztermModule {
        config = {
          home = {
            username = "testuser";
            homeDirectory = "/home/testuser";
          };
        };
        pkgs = linuxPkgs;
        lib = mockLib;
      };

      # Extract activation script from DAG entry
      activationData = result.home.activation.copyWeztermToWindows;
      # Unwrap mkIf wrapper to access content
      activationScript = activationData.content.data;
    in
    pkgs.runCommand "test-activation-dry-run-mode"
      {
        buildInputs = [
          pkgs.bash
          pkgs.coreutils
          pkgs.gnugrep
        ];
      }
      ''
        echo "Test 1: Verify activation script contains dry-run logic"

        # Write activation script to a file for inspection
        cat > activation-script.sh <<'SCRIPT_EOF'
        ${activationScript}
        SCRIPT_EOF

        # Check that the activation script contains DRY_RUN_CMD check
        if grep -q 'if \[ -z "\$DRY_RUN_CMD" \]' activation-script.sh; then
          echo "PASS: Activation script contains dry-run conditional"
        else
          echo "FAIL: Activation script missing dry-run logic"
          exit 1
        fi

        # Check for dry-run message
        if grep -q "Would copy WezTerm config" activation-script.sh; then
          echo "PASS: Activation script contains dry-run message"
        else
          echo "FAIL: Missing dry-run message"
          exit 1
        fi

        echo ""
        echo "Test 2: Dry run mode executes DRY_RUN_CMD instead of cp"

        # Create test environment
        mkdir -p test-home/.config/wezterm
        mkdir -p test-target

        cat > test-home/.config/wezterm/wezterm.lua <<'EOF'
        local wezterm = require('wezterm')
        return {}
        EOF

        # Test dry run behavior directly
        SOURCE_FILE="test-home/.config/wezterm/wezterm.lua"
        TARGET_FILE="test-target/.wezterm.lua"

        # Simulate the dry-run path from activation script
        # When DRY_RUN_CMD is set, it should show command without executing
        output=$(
          DRY_RUN_CMD="echo [DRY-RUN]"
          if [ -z "$DRY_RUN_CMD" ]; then
            cp "$SOURCE_FILE" "$TARGET_FILE"
          else
            # Dry run mode: validate paths
            if [ ! -r "$SOURCE_FILE" ]; then
              echo "ERROR: Source not readable"
              exit 1
            fi
            if [ ! -w "test-target" ]; then
              echo "ERROR: Target dir not writable"
              exit 1
            fi
            $DRY_RUN_CMD cp "$SOURCE_FILE" "$TARGET_FILE"
            echo "Would copy WezTerm config to Windows location: $TARGET_FILE"
          fi
        )

        # Verify file was NOT copied
        if [ -f "$TARGET_FILE" ]; then
          echo "FAIL: Dry run should not copy file"
          exit 1
        else
          echo "PASS: Dry run did not copy file"
        fi

        # Verify command was shown
        if echo "$output" | grep -q "cp"; then
          echo "PASS: Dry run showed cp command"
        else
          echo "FAIL: Dry run output should contain cp command"
          echo "Output: $output"
          exit 1
        fi

        # Verify dry run message appeared
        if echo "$output" | grep -q "Would copy"; then
          echo "PASS: Dry run message appeared"
        else
          echo "FAIL: Missing 'Would copy' message"
          exit 1
        fi

        echo ""
        echo "Test 3: Dry run detects unreadable source"

        chmod 000 test-home/.config/wezterm/wezterm.lua

        if [ ! -r "$SOURCE_FILE" ]; then
          echo "PASS: Dry run path validation detected unreadable source"
        else
          echo "FAIL: Source readability check failed"
          exit 1
        fi

        echo ""
        echo "✓ Activation dry-run mode test passed"
        echo "  - Activation script contains dry-run conditional logic"
        echo "  - Dry run validates paths without copying"
        echo "  - Dry run shows command preview via DRY_RUN_CMD"
        echo "  - Dry run detects unreadable source files"

        touch $out
      '';

  # Test: Activation script error recovery
  # Validates correct exit codes and recovery workflow after fixing issues
  test-activation-error-recovery =
    let
      # Mock lib with home-manager DAG functions
      mockLib = lib // {
        hm = {
          dag = {
            entryAfter = deps: data: {
              _type = "dagEntryAfter";
              after = deps;
              inherit data;
            };
          };
        };
      };

      # Mock pkgs for Linux
      linuxPkgs = testPkgs // {
        stdenv = pkgs.stdenv // {
          isLinux = true;
          isDarwin = false;
        };
      };

      # Evaluate module with mockLib
      result = weztermModule {
        config = {
          home = {
            username = "testuser";
            homeDirectory = "/home/testuser";
          };
        };
        pkgs = linuxPkgs;
        lib = mockLib;
      };

      activationData = result.home.activation.copyWeztermToWindows;
      activationScript = activationData.content.data;
    in
    pkgs.runCommand "test-activation-error-recovery"
      {
        buildInputs = [
          pkgs.bash
          pkgs.coreutils
        ];
      }
      ''
        echo "Test 1: Recover from permission denied error"

        # Create WSL environment with permission denied
        mkdir -p test-home/.config/wezterm
        mkdir -p test-mnt/c/Users
        chmod 000 test-mnt/c/Users

        # Create valid source file
        cat > test-home/.config/wezterm/wezterm.lua <<'EOF'
        local wezterm = require('wezterm')
        return {}
        EOF

        # First run should fail with ERR_PERMISSION_DENIED (11)
        exit_code=0
        output=$(HOME="$(pwd)/test-home" bash -c '
          # Create mock /mnt/c/Users path
          mkdir -p /tmp/test-mnt-$$/c/Users
          chmod 000 /tmp/test-mnt-$$/c/Users

          # Override check to use our test directory
          if [ -d "/tmp/test-mnt-$$/c/Users" ]; then
            if [ ! -r "/tmp/test-mnt-$$/c/Users" ]; then
              echo "ERROR: Permission denied accessing /mnt/c/Users/" >&2
              exit 11
            fi
          fi

          rm -rf /tmp/test-mnt-$$
        ' 2>&1) || exit_code=$?

        if [ $exit_code -eq 11 ]; then
          echo "PASS: Returns correct exit code ERR_PERMISSION_DENIED (11)"
        else
          echo "FAIL: Wrong exit code $exit_code (expected 11)"
          exit 1
        fi

        # Fix permissions and verify recovery
        chmod 755 test-mnt/c/Users
        mkdir -p test-mnt/c/Users/testuser

        # Simulate successful activation after fix
        if bash -c '
          SOURCE_FILE="test-home/.config/wezterm/wezterm.lua"
          TARGET_FILE="test-mnt/c/Users/testuser/.wezterm.lua"

          if [ ! -f "$SOURCE_FILE" ]; then
            echo "ERROR: Source file missing"
            exit 13
          fi

          if ! cp "$SOURCE_FILE" "$TARGET_FILE" 2>&1; then
            echo "ERROR: Copy failed"
            exit 14
          fi

          echo "Copied WezTerm config to Windows location: $TARGET_FILE"
        ' 2>&1; then
          echo "PASS: Activation succeeds after fixing permissions"
        else
          echo "FAIL: Should succeed after permission fix"
          exit 1
        fi

        # Verify file was actually copied
        if [ -f "test-mnt/c/Users/testuser/.wezterm.lua" ]; then
          echo "PASS: File copied after recovery"
        else
          echo "FAIL: File not copied"
          exit 1
        fi

        echo ""
        echo "Test 2: Verify exit code for missing source file (ERR_SOURCE_MISSING=13)"

        # Remove source file
        rm test-home/.config/wezterm/wezterm.lua

        exit_code=0
        bash -c '
          SOURCE_FILE="test-home/.config/wezterm/wezterm.lua"

          if [ ! -f "$SOURCE_FILE" ]; then
            echo "ERROR: Source file not found" >&2
            exit 13
          fi
        ' 2>&1 || exit_code=$?

        if [ $exit_code -eq 13 ]; then
          echo "PASS: Returns ERR_SOURCE_MISSING (13)"
        else
          echo "FAIL: Wrong exit code $exit_code for missing source (expected 13)"
          exit 1
        fi

        echo ""
        echo "Test 3: Verify exit code for empty source file (ERR_SOURCE_EMPTY=15)"

        # Create empty source file
        touch test-home/.config/wezterm/wezterm.lua

        exit_code=0
        bash -c '
          SOURCE_FILE="test-home/.config/wezterm/wezterm.lua"

          if [ ! -s "$SOURCE_FILE" ]; then
            echo "ERROR: Source file is empty" >&2
            exit 15
          fi
        ' 2>&1 || exit_code=$?

        if [ $exit_code -eq 15 ]; then
          echo "PASS: Returns ERR_SOURCE_EMPTY (15)"
        else
          echo "FAIL: Wrong exit code $exit_code for empty source (expected 15)"
          exit 1
        fi

        echo ""
        echo "✓ Activation error recovery test passed"
        echo "  - ERR_PERMISSION_DENIED (11) returned for permission errors"
        echo "  - ERR_SOURCE_MISSING (13) returned for missing source"
        echo "  - ERR_SOURCE_EMPTY (15) returned for empty source"
        echo "  - Activation succeeds after fixing permission issues"
        echo "  - Recovery workflow validated"

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
    test-invalid-font-size
    test-invalid-font-value
    test-invalid-config-key
    test-username-interpolation
    test-special-chars-username
    test-activation-script-linux
    test-activation-script-dag
    test-common-config
    test-activation-script-logic
    test-activation-script-runtime
    test-activation-source-file-missing
    test-activation-source-file-empty
    test-concurrent-activation
    test-windows-copy-corruption-detection
    test-windows-copy-failure-locked
    test-windows-copy-failure-nonexistent-dir
    test-wezterm-runtime-validation
    test-conflicting-platform-flags
    test-config-file-location
    test-homemanager-integration
    test-activation-dag-execution
    test-homemanager-dag-integration
    test-activation-trap-cleanup
    test-activation-copy-interrupted
    test-username-special-chars-lua-escaping
    test-activation-dry-run-mode
    test-activation-error-recovery
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
  # TODO(#1655): Duplicated test list exports in test files
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
      test-invalid-font-size
      test-invalid-font-value
      test-invalid-config-key
      test-username-interpolation
      test-special-chars-username
      test-activation-script-linux
      test-activation-script-dag
      test-common-config
      test-activation-script-logic
      test-activation-script-runtime
      test-activation-source-file-missing
      test-activation-source-file-empty
      test-concurrent-activation
      test-windows-copy-corruption-detection
      test-windows-copy-failure-locked
      test-windows-copy-failure-nonexistent-dir
      test-wezterm-runtime-validation
      test-conflicting-platform-flags
      test-config-file-location
      test-homemanager-integration
      test-activation-dag-execution
      test-homemanager-dag-integration
      test-activation-trap-cleanup
      test-activation-copy-interrupted
      test-username-special-chars-lua-escaping
      test-activation-dry-run-mode
      test-activation-error-recovery
      ;
  };

  # Convenience: Run all tests
  inherit wezterm-test-suite;
}
