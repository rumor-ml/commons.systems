# Timezone Configuration Module
#
# This module configures the timezone for your shell sessions through Home Manager.
# Sets the TZ environment variable to control how date/time commands display times.
#
# The TZ environment variable:
# - Controls timezone for date, ls -l, and other time-aware commands
# - Format: "Area/Location" (e.g., "America/New_York")
# - See /usr/share/zoneinfo for available timezones
# - Automatically handles Daylight Saving Time transitions
#
# Examples:
#   - "America/New_York"  → Eastern Time (EST/EDT)
#   - "America/Chicago"   → Central Time (CST/CDT)
#   - "America/Denver"    → Mountain Time (MST/MDT)
#   - "America/Los_Angeles" → Pacific Time (PST/PDT)
#   - "UTC"               → Coordinated Universal Time

{
  config,
  pkgs,
  lib,
  ...
}:

{
  home.sessionVariables = {
    # Set default timezone to Eastern Time (US)
    # This affects all shell sessions and commands that use localtime
    TZ = "America/New_York";
  };
}
