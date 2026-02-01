# Windows Configuration

This directory contains Windows-specific configuration files.

## Winget Packages

The `winget-packages.json` file contains a declarative list of Windows packages managed via [winget](https://learn.microsoft.com/en-us/windows/package-manager/winget/).

### Installing Packages

To install all packages from the configuration:

```powershell
winget import -i winget-packages.json
```

### Exporting Current Packages

To update the configuration with your current installed packages:

```powershell
winget export -o packages.json
```

Then copy the file to this repository:

```bash
cp /mnt/c/Users/$(whoami)/packages.json windows/winget-packages.json
# Or replace $(whoami) with your Windows username
```

### Package List

Current packages managed:

- **wez.wezterm** - WezTerm terminal emulator
- **GIMP.GIMP.3** - GNU Image Manipulation Program
- **Mozilla.Firefox** - Firefox web browser
- **Anthropic.Claude** - Claude desktop application
- **Inkscape.Inkscape** - Vector graphics editor

### Verifying Package Identifiers

> **⚠️ Build-Time Limitation:** The Nix build tests run on Linux/WSL and validate JSON structure and package identifier format, but **cannot verify** that packages are actually installable on Windows. This is a fundamental cross-platform limitation: the winget package manager and repository are only accessible from Windows, while Nix builds run in a Linux sandbox. Package availability depends on the winget repository state and your Windows version. Always verify package identifiers on Windows before adding them to the configuration.

To manually verify a package identifier before adding it to the configuration:

```powershell
# Search for a package
winget search <package-name>

# Show detailed information about a package
winget show <PackageIdentifier>

# Example: Verify WezTerm is available
winget show wez.wezterm
```

Common issues that build-time tests cannot catch:

- **Typos in package identifiers** - `wez.weztrem` instead of `wez.wezterm`
- **Deprecated or removed packages** - Package was renamed or removed from winget
- **Version compatibility** - Package requires Windows 11 but you have Windows 10
- **Architecture mismatches** - Package only supports ARM64 but you have x64

If a package fails to install, verify the identifier with `winget search` and check the official winget package repository at https://github.com/microsoft/winget-pkgs.

### Related Configuration

- WezTerm configuration is managed via Home-Manager (see `nix/home/wezterm.nix`)
- The WezTerm config is automatically synced from WSL to Windows at `/mnt/c/Users/natha/.wezterm.lua`
