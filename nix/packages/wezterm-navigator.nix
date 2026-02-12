{
  lib,
  buildGoModule,
}:

# TODO(#1992): Consider custom build error handling in Nix Go packages
buildGoModule {
  pname = "wezterm-navigator";
  version = "0.1.0";

  src = builtins.path {
    path = ../../wezterm-navigator;
    name = "wezterm-navigator-source";
    filter =
      path: type:
      let
        baseName = baseNameOf path;
      in
      baseName != ".git"
      && baseName != "result"
      && baseName != ".direnv"
      && baseName != "wezterm-navigator";
  };

  vendorHash = "sha256-uwBJAqN4sIepiiJf9lCDumLqfKJEowQO2tOiSWD3Fig=";

  subPackages = [ "cmd/wezterm-navigator" ];

  ldflags = [
    "-s"
    "-w"
  ];

  meta = with lib; {
    description = "Persistent navigator window for WezTerm with keybindings help";
    license = licenses.mit;
    platforms = platforms.unix;
  };
}
