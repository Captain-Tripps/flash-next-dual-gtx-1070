#!/bin/bash
# Step 5 (optional): GDDR5 memory overclock without an X server, via NVML.
#
# Under CUDA a GTX 1070 sits in P2 with memory at 3802 MHz (not the 4004 MHz max). nvidia-smi cannot lock memory
# clocks on GeForce Pascal, but NVML's nvmlDeviceSetMemClkVfOffset works headless on these cards (range -2000..2000,
# in transfer-rate units: +200 = +100 MHz on the clock nvidia-smi reports). No Coolbits, no X server, no VRAM cost.
#
# GDDR5 has no ECC, so an unstable offset gives silently wrong text. Find YOUR cards' limit with memtest (below) and
# run with margin. Ours: first errors at +1200 on one card (+1000 clean); we run +800.
#
# Off switch: sudo systemctl disable --now gpu-memoc   (back to stock now and at every boot)
set -euo pipefail
cd "$(dirname "$0")/memory-offset"

nvcc -O3 -arch=sm_61 -o memtest memtest.cu           # VRAM pattern test + copy bandwidth
sudo install -m 755 -o root -g root gpu-memoc /usr/local/sbin/gpu-memoc
sudo install -m 644 gpu-memoc.service /etc/systemd/system/gpu-memoc.service
sudo install -m 644 gpu-memoc.default /etc/default/gpu-memoc     # OFFSET=0 until you have tested
sudo systemctl daemon-reload

cat <<'MSG'
Installed (offset still 0). Sweep, with the inference server stopped so the test has the VRAM:
  for off in 0 200 400 600 800 1000 1200; do
    sudo gpu-memoc set $off
    ./memtest 0 6000 60 && ./memtest 1 6000 60 || { echo "errors at +$off"; break; }
  done
  sudo gpu-memoc off
Bandwidth should rise with the clock (ours: 204 -> 241 GB/s from +0 to +1200). Pick a value well below the first
error, soak it (./memtest N 6000 300 per card), check model output, then:
  sudo sed -i 's/^OFFSET=.*/OFFSET=800/' /etc/default/gpu-memoc && sudo systemctl enable --now gpu-memoc
MSG
