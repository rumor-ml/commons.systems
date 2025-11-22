{
  inputs = {
    base-flake.url = "path:/Users/n8/carriercommons/nix-base";
    nixpkgs.follows = "base-flake/nixpkgs";
    flake-utils.follows = "base-flake/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils, base-flake, ... }@inputs:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config = {
            allowUnfree = true;
          };
        };
        baseFlake = base-flake.lib.${system};
      in
      {
        devShells.default = baseFlake.mkDevShell {
          extraPackages = with pkgs; [
            # Node.js slim (has binaries for macOS)
            nodejs-slim
            
            # Additional project-specific packages
            ffmpeg-full
            chromaprint
            poppler_utils
            unrar
          ];
          
          extraShellHook = ''
          '';
        };
      });
}