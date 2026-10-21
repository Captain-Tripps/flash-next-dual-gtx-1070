#!/usr/bin/env bash
# Step 2: the Strata Terminal (no sudo) and the IQ3_S model (~89 GB download: 83.6 GB model + 5.2 GB MTP draft layer).
#
# On Pascal the launch ends with "couldn't find an engine for this computer": the signed feed's Linux CUDA 12 engine
# has no sm_61 code (it is built for sm_75/86/89). That is expected - the model still downloads and is prepared, and
# step 3 builds the engine. Exit code 0, nothing is started.
#
# Read the installer before running it (it only writes under ~/.local and checks the archive's SHA-256 and the
# release feed's signature):  curl -fsSL "$INSTALLER_URL" | less
set -euo pipefail

INSTALLER_URL=https://github.com/Niko1221/Strata/releases/latest/download/install.sh

mkdir -p ~/dl/strata-install
curl -fsSL "$INSTALLER_URL" -o ~/dl/strata-install/install.sh
sh ~/dl/strata-install/install.sh

# IQ3_S, both cards, no pictures. Launched at 64K; step 4 switches the run config to 128K (k8v4 + KV streaming).
# --access local keeps it on 127.0.0.1; --access tailscale or lan makes an API key for you. Name the preset as you like.
~/.local/bin/strata launch --model iq3_s --context 64k --vision off --gpu 0,1 \
    --access local --port 8080 --save-preset flashnext-iq3s --no-tui
