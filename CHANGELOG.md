# Changelog

## 2026-10-22

- GDDR5 memory offset via NVML (no X server): +800 -> P2 memory 3802 -> 4201 MHz, decode ~30.6 -> ~32.6 tok/s
  (+5-6%), prompt +1-2%. One card first showed VRAM errors at +1200. New optional
  `recipe/05-memory-offset.sh` (helper, boot unit with an off switch, VRAM pattern test).
- 16 more A/B runs (rounds 8-11) in `results/ab-runs.csv`, 62 in total. Round 11 re-checked `--pcie-frac` 0.05 /
  0.15 around 0.10 with the offset on: 0.10 stays (32.35 vs 31.7 / 30.4).
- Huge pages: already transparent huge pages for the expert arena, so not pursued.

## 2026-10-21

- First public version.
- Engine 0.1.46 built for sm_61 with CUDA 12.9 and packaged as a local Strata component.
- Tuned from 27.2 tok/s (setup defaults, 64K) to ~31 tok/s at 128K. Winners: `--pcie-frac 0.10`, the English draft
  vocabulary, and `--kv k8v4 --max-context 131072 --kv-resident 32768`.
- 46 completed A/B runs in `results/ab-runs.csv`. Decode profile, KV/context sweep and long-prompt (~63K / ~101K)
  results in `results/README.md`.
