# tmux-tui: TUI for managing tmux sessions
# Built as a proper Go derivation using buildGoModule
{ lib
, buildGoModule
, tmux
, makeWrapper
}:

buildGoModule {
  pname = "tmux-tui";
  version = "0.1.0";

  # Use the local source directory
  src = lib.cleanSource ../../tmux-tui;

  # vendorHash computed from go.sum
  # Computed by running nix build and copying the hash from the error message
  vendorHash = "sha256-xhf4vzHGxUdLviBuU7/B6cSrMrrF56I3WUa8dpct6Mk=";

  # Use proxyVendor to fetch dependencies via Go proxy
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
