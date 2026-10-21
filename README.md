# Qwen3.8-Flash-Next on dual GTX 1070 8GB (Strata)

**Hardware: two NVIDIA GeForce GTX 1070 8GB cards (Pascal, 2016; 16 GB combined, no NVLink), a 14-core Broadwell
Xeon and 64 GB of DDR4.**

This is a public log of running **Qwen3.8-Flash-Next**, a 125B-parameter MoE, on old mining cards with the
[Strata](https://github.com/Niko1221/Strata) engine. Strata supports GTX 10 cards only through an experimental
path, and its signed Linux packages contain no Pascal code, so this repo also covers building that engine.

Current setup (21 Oct 2026):

- **~31 output tok/s** (median of chat, code and prose; temperature 0, thinking on)
- **128K context**; prompt reading **~300-320 tok/s** from 9K to 63K tokens, **285 tok/s** at ~101K
- Model: `Qwen3.8-Flash-Next-GSQ-RCO-IQ3_S` (54.8 GB of RAM + VRAM), with the MTP draft layer (`--spec 4`)
- Strata **0.2.1** (engine 0.1.46, tag `v0.2.1`), **built for `sm_61` with CUDA 12.9**, NVIDIA driver 580
- Layer split across both cards, ~7.6 GB VRAM each; ~50 GB of system RAM in use

Setup's defaults on the same box gave 27.2 tok/s at 64K. Three changes took it to ~31 tok/s at 128K: a PCIe
miss-share setting, the English draft vocabulary, and k8v4 KV with KV streaming. All 46 A/B runs passed the same
correctness checks: [results/](results/).

| Config | Context | Decode tok/s | Prompt tok/s @ 2K / 9K / 29K |
| --- | --- | ---: | --- |
| setup defaults (int8 KV) | 64K | 27.2 (3 runs) | 222 / 300 / 307 |
| + `--pcie-frac 0.10` + English draft vocab | 64K | 31-32 | 224 / 303 / 317 |
| **+ `--kv k8v4 --max-context 131072 --kv-resident 32768`** | **128K** | **31.1** | **210 / 300 / 315** |
| k8v4 at 128K **without** KV streaming | 128K | 29.9 | 202 / 236 / 233 |

## The three changes that mattered

1. **`--pcie-frac 0.10`** (+13-15%). Strata picks how many expert-cache misses the GPU reads over PCIe instead of
   having the CPU compute them. Its startup probe chose 0.33 from the link speed (Gen3 x16, 12.1 GB/s). On a 1070,
   though, a PCIe expert read costs more than the CPU computing it: 0.45 -> 25.4 tok/s, 0.60 -> 22.1, 0.10 -> ~31.
   Exactly 0 loses the gain (27.2). With a layer split the engine does not refine this value at runtime, so measure it.
2. **English draft vocabulary** (`--mtp-draft-vocab .../data/draft_vocab_en.bin`, about +1 tok/s). It frees ~110 MiB
   on the card that holds the draft head, and the main model still verifies every token. Setup suggests it for 8 GB
   cards too.
3. **k8v4 KV + KV streaming for 128K.** int8 K keeps attention scores exact and V is 4-bit. Without streaming, the
   larger KV leaves the second card too few expert-cache slots to lend the prompt path, so the prompt chunk shrinks
   from 1,536 to 768 tokens and long prompts lose ~25%. `--kv-resident 32768` keeps 32K cells per layer in VRAM and
   the rest in 0.7 GiB of pinned RAM, which brings prompt speed back with no decode cost.

Things that did **not** help are listed in [results/README.md](results/README.md): spec depth, draft threshold,
4-bit draft layer, more CPU workers, window pipelining, bigger prompt chunks, FP32 dense GEMMs, the CPU governor,
q4_0 KV, a higher power limit (the cards draw 50-120 W of 151 W).

## Why ~31 is the ceiling on these cards

A decode window is ~86 ms for 2.35 tokens. About 70% is GPU work, which is bound by the 1070's 256 GB/s, about 19%
is waiting for experts computed on the CPU, and about 7% is the draft layer. Only ~1,500 experts fit in 2x8 GB, so
half of each token's experts run on the CPU. Next steps that matter are hardware ones: more VRAM, or a newer card
generation. Software settings do not move it. Full profile: [results/README.md](results/README.md#why-it-tops-out-near-31-toks-the-decode-profile).

## Machine

| | |
| --- | --- |
| GPUs | 2x NVIDIA GeForce GTX 1070 8GB (Pascal, sm_61), PCIe 3.0 x16 each |
| Combined VRAM | 16 GB |
| NVLink | No |
| CPU | Intel Xeon E5-2690 v4 (14 cores / 28 threads, AVX2, no AVX-512) |
| RAM | 64 GB DDR4-2133 RDIMM (this board runs 3 of 4 memory channels) |
| Storage | 1 TB NVMe |
| OS | Ubuntu 24.04.5 LTS, kernel 6.8 |
| Driver / CUDA | 580.178.04 (`nvidia-driver-580-server`) / CUDA 12.9.86 |
| Model | [ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-GGUF](https://huggingface.co/ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-GGUF) IQ3_S (via `strata launch --model iq3_s`) |

Details: [`hardware.json`](hardware.json).

## Reproduce

1. [`recipe/01-driver-and-cuda.sh`](recipe/01-driver-and-cuda.sh) installs driver 580 (the last branch for Pascal)
   and CUDA 12.9 (CUDA 13 cannot build sm_61). An apt pin stops NVIDIA's repo from replacing the driver. Reboot.
2. [`recipe/02-install-strata-and-model.sh`](recipe/02-install-strata-and-model.sh) installs the Strata Terminal
   (no sudo) and downloads the model, about 89 GB. It ends with "couldn't find an engine for this computer". That is
   expected.
3. [`recipe/03-build-sm61-engine.sh`](recipe/03-build-sm61-engine.sh) builds the engine with
   `-DSTRATA_EXPERIMENTAL_SM60=ON -DCMAKE_CUDA_ARCHITECTURES=61` (about 10 minutes) and packages it into Strata's
   component folder.
4. [`recipe/04-apply-tuned-config.py`](recipe/04-apply-tuned-config.py) applies the three changes above to the run
   config.
5. [`recipe/strata.service`](recipe/strata.service) runs it at boot as a systemd user service
   (`strata serve --profile ...`).
6. Measure on your box: [`benchmarks/ab_bench.py`](benchmarks/ab_bench.py) `--config <run config> --docs <folder of
   .md> --name baseline`, then the same with `--args "--pcie-frac 0.2"` and so on.

Gotchas we hit along the way are listed in [NOTES.md](NOTES.md).

This is one machine and one model. Expect different `--pcie-frac` winners with a different CPU or PCIe generation.
