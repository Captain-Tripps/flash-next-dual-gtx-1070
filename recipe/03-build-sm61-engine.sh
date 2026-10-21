#!/usr/bin/env bash
# Step 3: compile Strata's engine for Pascal (sm_61) with CUDA 12.9 and install it as a local engine component.
#
# Why by hand: the feed's Linux CUDA 12 engine has no sm_61 code, and `strata install -- --build` is ignored in the
# Terminal's managed mode (it only installs signed engine packages). packaging/package_engine.py makes an unsigned
# local package that `strata launch` / `strata serve` then pick up like an official one.
#
# Match the tag to your Terminal: `strata --version` 0.2.1 = engine 0.1.46 = tag v0.2.1. Rebuild after a Strata upgrade.
# ~10 minutes on 14 cores.
set -euo pipefail

TAG=v0.2.1
ENGINE_VERSION=0.1.46
SRC=~/src/strata-$TAG
NVCC=/usr/local/cuda-12.9/bin/nvcc
CUDA_LIB=/usr/local/cuda-12.9/lib64
COMPONENTS=~/.local/share/strata/components/engine
PY=~/.local/share/strata/terminal/current/python/bin/python3.12   # the Terminal's bundled Python

[ -d "$SRC" ] || git clone --depth 1 --branch "$TAG" https://github.com/Niko1221/Strata.git "$SRC"
cd "$SRC"

cmake -S . -B build-cuda12 -DCMAKE_BUILD_TYPE=Release -DSTRATA_ENABLE_CUDA=ON -DSTRATA_BUILD_TESTS=OFF \
      -DSTRATA_EXPERIMENTAL_SM60=ON -DCMAKE_CUDA_ARCHITECTURES=61 \
      -DCMAKE_CUDA_COMPILER="$NVCC" -DCUDAToolkit_ROOT=/usr/local/cuda-12.9
cmake --build build-cuda12 --target strata -j "$(nproc)"
# "nvcc warning: Support for offline compilation for architectures prior to sm_75 will be removed" is expected.

# package_engine.py's --search (copy missing libraries) is Windows-only, so stage the CUDA 12 runtime by hand.
# cp -L: the package refuses symlinks.
STAGE=$(mktemp -d)
cp build-cuda12/strata "$STAGE/"
cp -L "$CUDA_LIB/libcudart.so.12" "$CUDA_LIB/libcublas.so.12" "$CUDA_LIB/libcublasLt.so.12" "$STAGE/"

"$PY" packaging/package_engine.py --src "$STAGE" --backend cuda --version "$ENGINE_VERSION" --variant cuda12 \
      --out "$COMPONENTS" --arch sm_61 --min-driver nvidia=525.60 \
      --notes "local build for sm_61 (GTX 10 / P40), CUDA 12.9, -DSTRATA_EXPERIMENTAL_SM60=ON, tag $TAG"
rm -rf "$STAGE"

~/.local/bin/strata components engine      # should list 0.1.46 linux-x86_64-cuda ... -cuda-cuda12
