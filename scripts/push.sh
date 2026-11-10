#!/usr/bin/env bash
# Sube una rama a GitHub con la cuenta del repo (gh auth, usuario slop-cleanner-21). main despliega a producción en Vercel;
# las demás ramas no se despliegan (vercel.json).
#   bash scripts/push.sh main
#   bash scripts/push.sh contabilidad
set -euo pipefail
cd "$(dirname "$0")/.."
rama="${1:?Indica la rama}"
[ "$(git rev-parse --abbrev-ref "$rama" 2>/dev/null)" = "$rama" ] || { echo "No existe la rama $rama" >&2; exit 1; }
T="$(gh auth token --user slop-cleanner-21)"
git -c credential.helper= -c "credential.helper=!f() { echo username=x-access-token; echo password=$T; }; f" push origin "$rama"
