#!/usr/bin/env bash
# OSC 52 clipboard integration for tmux over SSH
# Reads text from stdin, encodes as base64, and outputs OSC 52 escape sequence

set -euo pipefail

# Read input from stdin
input=$(cat)

# Check if input is empty
if [ -z "$input" ]; then
    exit 0
fi

# Truncate at 100KB to respect terminal limits
max_bytes=102400
input_bytes=${#input}
if [ "$input_bytes" -gt "$max_bytes" ]; then
    input="${input:0:$max_bytes}"
fi

# Base64 encode the input
encoded=$(printf "%s" "$input" | base64 | tr -d '\n')

# Output OSC 52 escape sequence
# Format: ESC ] 52 ; c ; <base64> BEL
# \033 = ESC, \007 = BEL
printf "\033]52;c;%s\007" "$encoded"
