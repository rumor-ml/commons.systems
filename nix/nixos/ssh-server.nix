# NixOS SSH Server Configuration Module
#
# This module configures the OpenSSH server for secure remote access.
# To use this on a new NixOS machine, import it in /etc/nixos/configuration.nix:
#
#   imports = [ /path/to/your/repo/nix/nixos/ssh-server.nix ];
#
# Then rebuild:
#   sudo nixos-rebuild switch

{
  config,
  lib,
  pkgs,
  ...
}:

{
  services.openssh = {
    enable = true;

    settings = {
      # Security settings
      PermitRootLogin = "no";

      # Authentication methods
      # Enable password auth for initial setup, disable after adding SSH keys
      PasswordAuthentication = lib.mkDefault true;
      PubkeyAuthentication = true;

      # Require keyboard-interactive auth for password authentication (more secure)
      KbdInteractiveAuthentication = lib.mkDefault true;

      # Other security settings
      X11Forwarding = false;
      AllowAgentForwarding = true;
      AllowTcpForwarding = true;

      # Performance and connection settings
      ClientAliveInterval = 60;
      ClientAliveCountMax = 3;
    };

    # Additional SSH server settings
    extraConfig = ''
      # Limit authentication attempts
      MaxAuthTries 3

      # Limit concurrent sessions
      MaxSessions 10

      # Use modern, secure algorithms only
      Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com
      KexAlgorithms curve25519-sha256,curve25519-sha256@libssh.org,diffie-hellman-group16-sha512
      MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com
      HostKeyAlgorithms ssh-ed25519,rsa-sha2-512,rsa-sha2-256
    '';

    # Listen on all interfaces
    listenAddresses = [
      {
        addr = "0.0.0.0";
        port = 22;
      }
      {
        addr = "::";
        port = 22;
      }
    ];

    # Generate host keys
    hostKeys = [
      {
        path = "/etc/ssh/ssh_host_ed25519_key";
        type = "ed25519";
      }
      {
        path = "/etc/ssh/ssh_host_rsa_key";
        type = "rsa";
        bits = 4096;
      }
    ];
  };

  # Open firewall port for SSH
  networking.firewall.allowedTCPPorts = [ 22 ];

  # Bonus: Enable Avahi for mDNS (allows connecting via hostname.local)
  services.avahi = {
    enable = true;
    nssmdns4 = true;
    publish = {
      enable = true;
      addresses = true;
      domain = true;
      hinfo = true;
      userServices = true;
      workstation = true;
    };
  };
}
