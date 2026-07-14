#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SC_APP=${SC_APP:-/Applications/SuperCollider.app}
SCLANG=${SCLANG:-$SC_APP/Contents/MacOS/sclang}
SCSYNTH=${SCSYNTH:-$SC_APP/Contents/Resources/scsynth}
CONFIG="$ROOT/apps/desktop/src-tauri/resources/supercollider/sclang_conf.yaml"
CHECK="$ROOT/apps/desktop/src-tauri/resources/supercollider/compatibility-check.scd"

if [ ! -x "$SCLANG" ] || [ ! -x "$SCSYNTH" ]; then
  echo "SuperCollider binaries were not found under $SC_APP" >&2
  exit 2
fi

export LYRA_SCSYNTH_PATH="$SCSYNTH"
export XDG_CONFIG_HOME="${TMPDIR:-/tmp}/lyra-sc-config"
export XDG_DATA_HOME="${TMPDIR:-/tmp}/lyra-sc-data"
mkdir -p "$XDG_CONFIG_HOME" "$XDG_DATA_HOME"

"$SCLANG" -D -l "$CONFIG" "$CHECK"
