#!/bin/zsh

set -euo pipefail

PROJECT_DIR="${0:A:h}"
RUNTIME_NODE="/Users/zksun/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"

cd "$PROJECT_DIR"

if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
elif [[ -x "$RUNTIME_NODE" ]]; then
  NODE_BIN="$RUNTIME_NODE"
else
  print -u2 "未找到 Node.js，无法执行发布。"
  exit 1
fi

print "发布前检查……"
"$NODE_BIN" --test ../crypto-dashboard/tests/*.test.mjs
print ""
"$NODE_BIN" scripts/publish-github.mjs "$@"
