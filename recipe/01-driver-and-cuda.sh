#!/usr/bin/env bash
# Step 1 on a fresh Ubuntu 24.04 server: NVIDIA driver 580 + CUDA 12.9 toolkit for Pascal (GTX 10 series, sm_61).
#
# Why these versions:
#   - The 580 driver branch is the last one that supports Pascal. 590+ will not see the cards.
#   - CUDA 13 dropped sm_61 as a compile target, so the engine must be built with CUDA 12.x (12.9 here).
#   - Ubuntu 24.04: NVIDIA's CUDA 12 apt packages target it, and its 6.8 kernel matches the prebuilt 580 modules.
#
# Secure Boot can stay ON: linux-modules-nvidia-580-server-generic is Canonical-signed (a DKMS build would need MOK).
# Run as a user with sudo. Reboot at the end.
set -euo pipefail

sudo apt update && sudo apt full-upgrade -y

# Driver: Ubuntu's prebuilt, signed 580 server branch.
sudo apt install -y linux-modules-nvidia-580-server-generic nvidia-driver-580-server nvidia-utils-580-server

# CUDA 12.9 toolkit from NVIDIA's repo, WITHOUT letting that repo replace Ubuntu's 580 driver.
wget -q https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2404/x86_64/cuda-keyring_1.1-1_all.deb
sudo dpkg -i cuda-keyring_1.1-1_all.deb
printf 'Package: *nvidia* cuda-drivers*\nPin: origin developer.download.nvidia.com\nPin-Priority: 100\n' \
  | sudo tee /etc/apt/preferences.d/cuda-repo-no-driver
sudo apt update
sudo apt install -y cuda-toolkit-12-9 build-essential cmake git

# Optional but recommended: keep unattended-upgrades off the kernel + NVIDIA packages, so a kernel never arrives
# without its matching prebuilt driver module. Update those two together by hand (apt full-upgrade + reboot).
printf 'Unattended-Upgrade::Package-Blacklist {\n    "nvidia";\n    "linux-";\n};\n' \
  | sudo tee /etc/apt/apt.conf.d/51unattended-upgrades-pascal

echo "Done. Reboot, then check: nvidia-smi (both cards, driver 580.x) and /usr/local/cuda-12.9/bin/nvcc --version"
