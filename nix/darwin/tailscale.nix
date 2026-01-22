# Tailscale VPN Module for nix-darwin (macOS)
#
# Tailscale provides secure, zero-config VPN networking between your machines.
# Perfect for connecting macOS clients to your infrastructure.
#
# Benefits:
# - Stable IP addresses that don't change
# - Secure encrypted connections between your devices
# - Works from anywhere (not just LAN)
# - No router configuration or port forwarding needed
# - Simple hostname-based access (machine-name.tail-scale-network.ts.net)
#
# After enabling this module:
#   1. Rebuild: darwin-rebuild switch --flake .#<hostname>
#   2. Authenticate: sudo tailscale up
#   3. Get your IP: tailscale ip -4
#   4. SSH to other machines: ssh user@machine-name.your-tailnet.ts.net
#
# Learn more: https://tailscale.com/

{
  config,
  pkgs,
  lib,
  ...
}:

{
  # Enable Tailscale VPN service
  services.tailscale = {
    enable = true;
  };

  # Install Tailscale package
  # nix-darwin's services.tailscale automatically installs it,
  # but we add it to systemPackages for convenience
  environment.systemPackages = with pkgs; [
    tailscale
  ];

  # Optional: Tailscale configuration
  # Note: On macOS, most Tailscale configuration is done through the GUI or CLI
  # The nix-darwin module handles service installation and startup

  # Ensure the service starts on boot
  # This is handled automatically by nix-darwin's services.tailscale
}
