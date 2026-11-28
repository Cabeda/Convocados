#!/bin/sh
# THROWAWAY prototype helper: print the post-game prototype URL for this checkout.
# Usage: pnpm prototype:postgame <eventId>   (id is printed by pnpm db:seed:prototype-postgame)
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PORT=$(cat "$ROOT/.dev-port" 2>/dev/null || echo 4321)
ID=${1:-<eventId>}
echo "http://localhost:$PORT/prototype/post-game/$ID            (compare, default)"
echo "http://localhost:$PORT/prototype/post-game/$ID?variant=A  (also B, C; ←/→ cycles)"
echo "Sign in first at http://localhost:$PORT/auth/signin  (demo@convocados.app / demo123). Start the server with: pnpm dev"
