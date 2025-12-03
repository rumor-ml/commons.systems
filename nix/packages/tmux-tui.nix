# tmux-tui: Custom TUI for managing tmux sessions
#
# This package uses buildGoModule to build a Go application from source with
# reproducible dependency management via Nix.
#
# buildGoModule vs stdenv.mkDerivation:
# - Use buildGoModule when building Go projects from source
# - buildGoModule handles Go module dependency resolution automatically
# - It fetches dependencies based on go.mod and verifies them with vendorHash
# - Alternative (stdenv.mkDerivation) is used for pre-built binaries or non-Go builds
#
# How vendorHash works:
# - Nix needs to download Go dependencies reproducibly
# - vendorHash is a SHA256 hash of all dependencies listed in go.mod
# - When dependencies change, vendorHash must be updated
#
# When to update vendorHash:
# 1. When you modify go.mod (add/remove/update dependencies)
# 2. When Nix reports a hash mismatch error
#
# How to get the correct vendorHash:
# Method 1: Let Nix tell you
#   nix build .#tmux-tui
#   # Error: hash mismatch, got: sha256-xyz...
#   # Copy the "got" hash to vendorHash below
#
# Method 2: Use a placeholder
#   vendorHash = lib.fakeHash;
#   # Build once, Nix outputs the correct hash, then replace
#
# Wrapper purpose:
# - The postInstall phase wraps the binary with wrapProgram
# - This ensures tmux-tui can find tmux in its PATH without requiring
#   tmux to be globally installed
# - It also sets environment variables pointing to bundled scripts/config
#
{ lib
, buildGoModule
, tmux
, makeWrapper
}:

buildGoModule {
  pname = "tmux-tui";
  version = "0.1.0";

  # Use the local source directory (filtered to exclude .git, etc.)
  # Using builtins.path instead of lib.cleanSource to support git worktrees
  src = builtins.path {
    path = ../../tmux-tui;
    name = "tmux-tui-source";
    filter = path: type:
      let
        baseName = baseNameOf path;
      in
        # Exclude build artifacts, git, and temp files
        baseName != ".git" &&
        baseName != "result" &&
        baseName != ".direnv" &&
        !(lib.hasSuffix ".swp" baseName) &&
        !(lib.hasSuffix "~" baseName);
  };

  # vendorHash: SHA256 hash of Go module dependencies
  # Computed by running nix build and copying the hash from the error message
  # Update this when go.mod changes
  vendorHash = "sha256-xhf4vzHGxUdLviBuU7/B6cSrMrrF56I3WUa8dpct6Mk=";

  # Use proxyVendor to fetch dependencies via Go module proxy
  # This is more reliable than vendor directory
  proxyVendor = true;

  # Build from cmd/tmux-tui
  subPackages = [ "cmd/tmux-tui" ];

  # Strip debug symbols for smaller binary
  ldflags = [ "-s" "-w" ];

  # tmux is needed at runtime
  buildInputs = [ tmux makeWrapper ];

  # Post-install: copy scripts and config to derivation output
  postInstall = ''
    # Create share directory for tmux-tui resources
    mkdir -p $out/share/tmux-tui

    # Copy scripts and config
    cp -r $src/scripts $out/share/tmux-tui/
    cp $src/tmux-tui.conf $out/share/tmux-tui/

    # Make scripts executable
    chmod +x $out/share/tmux-tui/scripts/*.sh

    # Wrap the binary to know where its resources are
    wrapProgram $out/bin/tmux-tui \
      --set TMUX_TUI_SCRIPTS $out/share/tmux-tui/scripts \
      --set TMUX_TUI_CONFIG $out/share/tmux-tui/tmux-tui.conf
  '';

  meta = with lib; {
    description = "TUI for managing tmux sessions in the commons.systems monorepo";
    homepage = "https://github.com/commons-systems/tmux-tui";
    license = licenses.mit;
    maintainers = [ ];
    platforms = platforms.unix;
  };
}
