# WezTerm Configuration with Home-Manager

This document describes how WezTerm terminal emulator configuration is managed through Home-Manager in this repository.

## Architecture Overview

### Configuration Management

WezTerm configuration is declaratively managed through Home-Manager:

1. **Source Configuration**: `nix/home/wezterm.nix`
   - Defines WezTerm settings using Home-Manager's `programs.wezterm` module
   - Uses Nix expressions to generate Lua configuration
   - Includes platform-specific settings via `lib.optionalString`

2. **Generated Configuration**: `~/.config/wezterm/wezterm.lua`
   - Respects `$XDG_CONFIG_HOME` (defaults to `~/.config`)
   - Home-Manager generates this file during `home-manager switch`
   - Contains the final Lua configuration that WezTerm reads
   - Regenerated on every Home-Manager activation

3. **Windows Copy (WSL only)**: `/mnt/c/Users/<username>/.wezterm.lua`
   - On WSL, Home-Manager automatically copies the config to Windows
   - Uses `home.activation` script that runs after config generation
   - Ensures Windows WezTerm installation uses the same configuration

## Platform-Specific Behavior

### Linux (WSL)

When running on WSL, the configuration includes:

- **WSL Integration**: Sets `default_prog` to launch WSL automatically, with your username interpolated from `config.home.username`:

  ```lua
  config.default_prog = { 'wsl.exe', '-d', 'NixOS', '--cd', '/home/' .. "your-username" }
  ```

  (The generated config concatenates `/home/` with your username using Lua's `..` operator. The username is safely escaped using Nix's `lib.strings.toJSON` to prevent Lua syntax errors from special characters like quotes.)

- **Windows Copy**: Activation script copies config to Windows location
  - Source: `~/.config/wezterm/wezterm.lua`
  - Destination: `/mnt/c/Users/<username>/.wezterm.lua`
  - Only runs if `/mnt/c/Users/<username>` directory exists

### macOS

When running on macOS, the configuration includes:

- **Native Fullscreen**: Enables macOS fullscreen mode
  ```lua
  config.native_macos_fullscreen_mode = true
  ```

### All Platforms

Common settings applied on all platforms:

- **Font**: JetBrains Mono Nerd Font at 11pt (must be installed separately - see Initial Setup)
- **Color Scheme**: Tokyo Night
- **Scrollback**: 10,000 lines
- **Tab Bar**: Hidden when only one tab is open
- **Window Padding**: 2px on all sides

## Configuration Flow

```
┌─────────────────────────────────────┐
│  nix/home/wezterm.nix               │
│  (Nix expression with platform      │
│   detection and Lua generation)     │
└──────────────┬──────────────────────┘
               │
               │ home-manager switch
               │
               ▼
┌─────────────────────────────────────┐
│  ~/.config/wezterm/wezterm.lua      │
│  (Generated Lua configuration)      │
└──────────────┬──────────────────────┘
               │
               │ (WSL only - activation script)
               │
               ▼
┌─────────────────────────────────────┐
│  /mnt/c/Users/<user>/.wezterm.lua   │
│  (Windows WezTerm configuration)    │
└─────────────────────────────────────┘
```

## Usage

### Initial Setup

1. Ensure WezTerm is installed on your system:
   - **WSL**: Install WezTerm on Windows from https://wezfurlong.org/wezterm/
   - **macOS**: Install via Homebrew: `brew install --cask wezterm`
   - **Linux**: Install via package manager or from website

2. Enable the module by running Home-Manager:

   ```bash
   cd /path/to/repo
   home-manager switch --flake .#default --impure
   ```

3. Verify configuration was generated:

   ```bash
   # Check Linux/WSL config
   ls -la ~/.config/wezterm/wezterm.lua

   # Check Windows config (WSL only)
   ls -la /mnt/c/Users/$(whoami)/.wezterm.lua
   ```

4. **Install Required Fonts**: The configuration uses **JetBrains Mono Nerd Font**. Ensure it's installed:
   - **WSL**: Install JetBrains Mono Nerd Font on Windows (the WezTerm process runs on Windows and looks for fonts there, not in WSL)
     - Download from https://www.jetbrains.com/lp/mono/
     - Or install via winget: `winget install JetBrains.JetBrainsMono.NerdFont`

   - **macOS**: Install via Homebrew

     ```bash
     brew tap homebrew/cask-fonts
     brew install --cask font-jetbrains-mono
     ```

   - **Linux**: Install via package manager or manually

     ```bash
     # Debian/Ubuntu
     sudo apt install fonts-jetbrains-mono

     # Arch Linux
     sudo pacman -S ttf-jetbrains-mono

     # Manual installation
     mkdir -p ~/.local/share/fonts
     cd ~/.local/share/fonts
     wget https://github.com/JetBrains/JetBrainsMono/releases/download/v2.304/JetBrainsMono-2.304.zip
     unzip JetBrainsMono-2.304.zip
     fc-cache -f -v
     ```

   **Verify font installation:**
   - **WSL/Linux**: `fc-list | grep -i "jetbrains"`
   - **macOS**: Check Font Book application
   - **Windows**: Check Settings → Fonts

   **Note**: If JetBrains Mono Nerd Font is not installed, WezTerm will typically fall back to its default font. To verify your font is being used, open WezTerm and check the terminal appearance matches the intended design.

### Making Changes

1. Edit the configuration in `nix/home/wezterm.nix`

2. Apply changes:

   ```bash
   home-manager switch --flake .#default --impure
   ```

3. Restart WezTerm to load the new configuration

### Customization Guide

#### Changing Font

Edit `nix/home/wezterm.nix`:

```nix
config.font = wezterm.font('Your Font Name')
config.font_size = 12.0
```

#### Changing Color Scheme

Browse available schemes: https://wezfurlong.org/wezterm/colorschemes/index.html

```nix
config.color_scheme = 'Your Scheme Name'
```

#### Adding Custom Keybindings

Add to `extraConfig` section:

```nix
extraConfig = ''
  local wezterm = require('wezterm')
  local config = wezterm.config_builder()

  -- ... existing config ...

  config.keys = {
    -- Example: Ctrl+Shift+T to open new tab
    { key = 'T', mods = 'CTRL|SHIFT', action = wezterm.action.SpawnTab 'CurrentPaneDomain' },
  }

  return config
'';
```

#### Platform-Specific Customization

Use `lib.optionalString` for conditional configuration:

```nix
${lib.optionalString pkgs.stdenv.isLinux ''
  -- Linux-specific settings
  config.enable_wayland = true
''}

${lib.optionalString pkgs.stdenv.isDarwin ''
  -- macOS-specific settings
  config.send_composed_key_when_left_alt_is_pressed = false
''}
```

## Testing and Verification

### Verify Configuration Syntax

Check that the generated Lua is valid:

```bash
# View generated config
cat ~/.config/wezterm/wezterm.lua

# Test Lua syntax (if lua is installed)
lua -e "dofile('${HOME}/.config/wezterm/wezterm.lua')"
```

### Verify Windows Copy (WSL)

```bash
# Check Windows config exists
ls -la /mnt/c/Users/$(whoami)/.wezterm.lua

# Compare with WSL config
diff ~/.config/wezterm/wezterm.lua /mnt/c/Users/$(whoami)/.wezterm.lua
```

### Verify WezTerm Reads Config

1. Open WezTerm
2. Press `Ctrl+Shift+L` to open the launcher, then select "Debug Overlay"
   (or check Help → Show Debug Overlay from the menu)
3. Check for configuration errors in the output
4. Verify settings match your expectations (font, colors, etc.)

### Test WSL Integration (WSL)

If running WezTerm on Windows with WSL integration:

1. Open WezTerm on Windows
2. Should automatically launch into WSL NixOS
3. Working directory should be `/home/<username>`
4. Verify with: `pwd` (should show `/home/<username>`)

## Troubleshooting

### Configuration Not Applied

**Problem**: Changes to `wezterm.nix` not reflected in WezTerm

**Solutions**:

1. Run `home-manager switch --flake .#default --impure`
2. Verify generation succeeded without errors
3. Restart WezTerm completely (quit and reopen)
4. Check `~/.config/wezterm/wezterm.lua` was updated (check timestamp)

### Windows Config Not Copied (WSL)

**Problem**: `/mnt/c/Users/<username>/.wezterm.lua` not created

**Solutions**:

1. Verify WSL mount exists: `ls /mnt/c/Users/$(whoami)`
2. Check Home-Manager output for activation script messages
3. Manually verify permissions: `touch /mnt/c/Users/$(whoami)/test.txt`
4. Run activation script manually:
   ```bash
   cp ~/.config/wezterm/wezterm.lua /mnt/c/Users/$(whoami)/.wezterm.lua
   ```

### Lua Syntax Errors

**Problem**: WezTerm shows errors on startup

**Solutions**:

1. Check the generated config: `cat ~/.config/wezterm/wezterm.lua`
2. Look for unescaped quotes or invalid Lua syntax
3. Test with minimal config by commenting out sections in `wezterm.nix`
4. Verify interpolated variables (like `config.home.username`) are valid

### Font Not Found

**Problem**: WezTerm falls back to default font

**Solutions**:

1. Verify font is installed on the system:
   - **WSL**: Font must be installed on Windows, not in WSL
   - **macOS**: Check Font Book application
   - **Linux**: Use `fc-list` to list available fonts
2. Use exact font name as shown by system
3. Try using font family instead: `wezterm.font_with_fallback({ 'Font Name' })`

### WSL Not Launching

**Problem**: Windows WezTerm doesn't launch WSL automatically

**Solutions**:

1. Verify WSL distribution name: `wsl -l -v`
2. Update `default_prog` in `wezterm.nix` if using different distribution
3. Verify WSL is working: `wsl.exe -d NixOS` from PowerShell
4. Check Windows PATH includes WSL: `where wsl.exe` in PowerShell

### Platform Detection Issues

**Problem**: Wrong platform-specific settings applied

**Solutions**:

1. Check detected platform: `nix eval --impure --expr 'builtins.currentSystem'`
2. Verify conditional logic: `lib.optionalString pkgs.stdenv.isLinux` vs `.isDarwin`
3. Review generated config to see which sections were included
4. Explicitly specify system: `home-manager switch --flake .#x86_64-linux --impure`

## Related Files

- **Module**: `nix/home/wezterm.nix` - Main configuration module
- **Import**: `nix/home/default.nix` - Imports wezterm.nix
- **Generated Config**: `~/.config/wezterm/wezterm.lua` - Auto-generated Lua config
- **Windows Config**: `/mnt/c/Users/<username>/.wezterm.lua` - WSL copy for Windows

## References

- [WezTerm Official Documentation](https://wezfurlong.org/wezterm/)
- [WezTerm Configuration Reference](https://wezfurlong.org/wezterm/config/files.html)
- [WezTerm Lua API](https://wezfurlong.org/wezterm/config/lua/general.html)
- [Home-Manager Manual](https://nix-community.github.io/home-manager/)
- [Home-Manager WezTerm Module](https://nix-community.github.io/home-manager/options.xhtml#opt-programs.wezterm.enable)
