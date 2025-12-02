{ pkgs }:

''
  # pnpm uses global store by default (~/.pnpm-store)
  # This is shared across all worktrees automatically

  # Smart pnpm install - only when lockfile changes
  if [ ! -d "node_modules" ]; then
    echo "Installing pnpm dependencies..."
    pnpm install
    echo "Dependencies installed"
  elif [ "pnpm-lock.yaml" -nt "node_modules/.modules.yaml" ]; then
    echo "pnpm-lock.yaml changed, reinstalling..."
    pnpm install
    echo "Dependencies updated"
  fi

  # Add node_modules/.bin to PATH
  export PATH="$PWD/node_modules/.bin:$PATH"
''
