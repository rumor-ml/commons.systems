{
  description = "macOS configuration with nix-darwin";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    darwin = {
      url = "github:LnL7/nix-darwin";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      darwin,
      home-manager,
      ...
    }:
    {
      darwinConfigurations = {
        # Configuration name matches hostname: Nathans-MacBook-Air
        "Nathans-MacBook-Air" = darwin.lib.darwinSystem {
          system = "aarch64-darwin"; # Use "x86_64-darwin" for Intel Macs
          modules = [
            ./configuration.nix

            # Optional: Integrate Home Manager with nix-darwin
            home-manager.darwinModules.home-manager
            {
              home-manager = {
                useGlobalPkgs = true;
                useUserPackages = true;
                # Backup existing files with .bak extension
                backupFileExtension = "bak";
                # Point to your home manager config from the parent repo
                # Adjust the path based on where you clone this repo
                users.n8 =
                  {
                    config,
                    pkgs,
                    lib,
                    ...
                  }:
                  {
                    imports = [ ../home ];
                    # Explicitly set user identity for nix-darwin integration
                    home.username = lib.mkForce "n8";
                    home.homeDirectory = lib.mkForce "/Users/n8";
                  };
              };
            }
          ];
        };
      };
    };
}
