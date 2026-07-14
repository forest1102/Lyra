#!/bin/sh
set -eu

VERSION=3.14.1
CACHE_ROOT=${LYRA_SC_BUILD_ROOT:-"${TMPDIR:-/tmp}/lyra-supercollider-$VERSION"}
ARCHIVE="$CACHE_ROOT/SuperCollider-$VERSION-Source.tar.bz2"
SOURCE="$CACHE_ROOT/SuperCollider-$VERSION-Source"
BUILD="$CACHE_ROOT/build"
RUNTIME_DIR=${LYRA_SC_RUNTIME_DIR:-"$HOME/Library/Application Support/app.lyra.focus/supercollider/runtime"}

mkdir -p "$CACHE_ROOT" "$RUNTIME_DIR"
if [ ! -f "$ARCHIVE" ]; then
  curl -L "https://github.com/supercollider/supercollider/releases/download/Version-$VERSION/SuperCollider-$VERSION-Source.tar.bz2" -o "$ARCHIVE"
fi
if [ ! -d "$SOURCE" ]; then
  tar -xf "$ARCHIVE" -C "$CACHE_ROOT"
fi

nix shell nixpkgs#cmake nixpkgs#ninja -c cmake \
  -S "$SOURCE" \
  -B "$BUILD" \
  -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DSC_QT=OFF \
  -DSC_IDE=OFF \
  -DSUPERNOVA=OFF \
  -DSCLANG_SERVER=OFF \
  -DNOVA_SIMD=OFF \
  -DNO_LIBSNDFILE=ON \
  -DCMAKE_DISABLE_FIND_PACKAGE_Readline=TRUE \
  "-DCMAKE_EXE_LINKER_FLAGS=-framework Foundation"
nix shell nixpkgs#cmake nixpkgs#ninja -c cmake --build "$BUILD" --target sclang -j 8
install -m 0755 "$BUILD/lang/sclang" "$RUNTIME_DIR/sclang"

echo "Installed arm64 headless sclang at $RUNTIME_DIR/sclang"
