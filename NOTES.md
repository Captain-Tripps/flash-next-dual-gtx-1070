# Gotchas (Strata 0.2.1 on Linux, Pascal)

Things that cost time, in the order they bite. Several are worth an upstream issue.

1. **The signed feed has no Linux engine for sm_61.** `strata update --check` lists
   `0.1.46 linux-x86_64-cuda-cuda12 has code for sm_75, sm_86, sm_89, compute_89` and `this PC's GPU is sm_61`.
   docs/OLDER_GPUS.md says Linux compiles the CUDA 12 engine, but that holds only for a source checkout's
   `./setup.sh`.
2. **`strata install -- --build ...` does not compile in the Terminal.** It runs setup in its managed
   (component) mode, prepares the model and writes the run config, but builds nothing. Also note the `--` before
   setup's arguments; without it, `strata install --model ...` is "unrecognized arguments".
3. **`packaging/package_engine.py --search` only works on Windows.** On Linux it refuses with
   "strata needs libcublas.so.12 / libcudart.so.12". Copy `libcudart.so.12`, `libcublas.so.12` and
   `libcublasLt.so.12` into the staging folder yourself, using `cp -L`, because the package refuses symlinks.
4. **`strata launch` keeps its own copy of the run config** in `~/.local/state/strata/launch/<preset>.json`. A first
   launch without `--gpu 0,1` stays on one card even after `strata install -- --gpus 0,1`. Pass `--gpu 0,1` together
   with `--save-preset`. Hand edits to that file are lost when `strata launch` regenerates it, so serve with
   `strata serve --profile <that file>`.
5. **The `--pcie-frac` probe is a guess on this hardware.** It picks 0.33 from link bandwidth. Runtime refinement
   (`pcie_frac_auto`) only happens on a single GPU. Here 0.10 was 15% faster.
6. **`--pipeline-windows 2` needs `STRATA_MTP_STAGE0=1` on NVIDIA** to move the draft layer to the first card. Even
   then it gave no decode gain here. Requests with thinking off pick up the model card's `presence_penalty 1.5`, and
   any penalty makes a request decode serially.
7. **`--prefill-head-alias` supports one GPU only.** With a layer split the engine exits at start.
8. **The driver and the kernel must move together.** Ubuntu's prebuilt `linux-modules-nvidia-580-server-*` is built
   per kernel. Keep unattended-upgrades off `linux-*` and `nvidia*`, and update both by hand.
9. **The engine's own warning is worth reading.** With 8 GB cards it warns when a card has under 512 MiB free at the
   start of a request (`--vram-reserve-later-mib`), and it names exactly why the prompt chunk is smaller than asked.
