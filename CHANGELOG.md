# Changelog

## 2026-10-21

- First public version.
- Engine 0.1.46 built for sm_61 with CUDA 12.9 and packaged as a local Strata component.
- Tuned from 27.2 tok/s (setup defaults, 64K) to ~31 tok/s at 128K. Winners: `--pcie-frac 0.10`, the English draft
  vocabulary, and `--kv k8v4 --max-context 131072 --kv-resident 32768`.
- 46 completed A/B runs in `results/ab-runs.csv`. Decode profile, KV/context sweep and long-prompt (~63K / ~101K)
  results in `results/README.md`.
