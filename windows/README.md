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
cp /mnt/c/Users/natha/packages.json windows/winget-packages.json
```

### Package List

Current packages managed:

- **wez.wezterm** - WezTerm terminal emulator
- **GIMP.GIMP.3** - GNU Image Manipulation Program
- **Mozilla.Firefox** - Firefox web browser
- **Anthropic.Claude** - Claude desktop application
- **Inkscape.Inkscape** - Vector graphics editor

### Related Configuration

- WezTerm configuration is managed via Home-Manager (see `nix/home/wezterm.nix`)
- The WezTerm config is automatically synced from WSL to Windows at `/mnt/c/Users/natha/.wezterm.lua`
