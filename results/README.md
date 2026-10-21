# A/B log: Strata on 2x GTX 1070 (Oct 2026)

Every arm is in [`ab-runs.csv`](ab-runs.csv) (46 runs that completed; two more failed to start, noted below).
Harness: [`benchmarks/ab_bench.py`](../benchmarks/ab_bench.py).

## Method

- One test server per arm, started from a copy of the run config with one change. The serving instance is stopped
  so the arm has both cards to itself.
- Warm-up: one short request, then one 300-token answer so the adaptive expert cache settles.
- **Correctness first:** `17*23` -> `391`, capital of Australia -> `Canberra`, and an exact JSON echo. All 46 arms
  passed. A speed number from a model producing garbage is meaningless, because wrong drafts still count as tokens.
- **Decode:** three prompts (a ~250-word explanation, an LRU-cache class in Python, a ~300-word story), thinking on,
  512 max tokens, temperature 0, two runs each. The headline number is the median of those six
  (`timings.predicted_per_second`).
- **Prompt reading:** filler prompts of ~2K, ~9K and ~29K tokens (and ~63K / ~101K in `--long`), thinking off, 48
  max tokens (`timings.prompt_per_second`, fresh tokens only).
- **Noise:** about +-1 tok/s run to run on decode. The baseline was measured three times (27.7 / 26.8 / 27.0).

Decode speed with an MTP draft layer depends on how often the guesses are right, so it changes with the prompt.
These prompts are ordinary chat, code and prose. They are not repeated filler, which flatters MTP.

## Round by round

Baseline (setup's config: int8 KV, 64K, `--spec 4 --spec-min-p 0.5`, automatic expert cache, `--prefill auto`):
**~27.2 tok/s decode**, prompt 222 / 300 / 307 tok/s at 2K / 9K / 29K.

| Round | Change | Decode | Verdict |
| --- | --- | ---: | --- |
| 1 | English draft vocab (`--mtp-draft-vocab draft_vocab_en.bin`) | 28.6 | noise alone, kept later (+~1) |
| 1 | `--mtp-q4 proj` / `--mtp-q4 all` | 28.1 / 28.6 | noise |
| 1 | `--spec 3` / **`--spec 6`** | 28.0 / **23.9** | 6 is -14% |
| 1 | `--spec-min-p 0.7` / **`0.3`** | 28.2 / **24.0** | 0.3 is -13% |
| 1 | `--pool-workers 14` / `20` (SMT) | 27.8 / 26.8 | default (13 + host) is right |
| 1 | `--lookup-chain 4` | 28.5 | noise |
| 1 | `--max-context 32768` (+143 cache slots) | 27.1 | **more cache slots did nothing** |
| 2 | `--pipeline-windows 2` (+ vocab, + q4) | 27.7-28.0 | no gain; prompt -18% at 9K |
| 2 | **`--pcie-frac 0.45` / `0.60`** | **25.4 / 22.1** | more PCIe = slower |
| 2 | `--prefill 2048` / `4096` | 27.6 / 27.8 | prompt **-37%** (borrows cache VRAM) |
| 2 | `STRATA_DENSE_F32=1` (confirmed active) | 27.1 | no prompt gain at 9K |
| 2 | `--prefill-pipe 1` | 27.1 | noise |
| 3 | **`--pcie-frac 0.20` / `0.10`** | **31.1 / 31.2** | **winner** |
| 3 | `--pipeline-windows 2` + `STRATA_MTP_STAGE0=1` | 29.6 | prompt +12% at 9K, -8% at 2K |
| 4 | `--pcie-frac 0` | 27.2 | 0 loses the gain |
| 4 | `--pcie-frac 0.10` repeat | 30.2 | holds |
| 4 | pcie 0.10 / 0 + pipelining + stage 0 | 29.5 / 31.0 | does not stack |
| 4 | **`--pcie-frac 0.10` + English vocab** | **32.0** | **winner (+18%)** |
| 4 | CPU governor `performance` (x2) | 31.1 / 31.2 | no gain |

Rounds 5-7 start from the winner (int8, 64K, ~31 tok/s) and look for a longer context:

| Run | KV / context | Decode | Prompt 2K / 9K / 29K | Prompt ~63K / ~101K |
| --- | --- | ---: | --- | --- |
| winner | int8, 64K | 28.9-31.0 | 224 / 303-307 / 317 | - |
| q4_0 | 64K | 30.8 | 208 / 303 / 310 | - |
| q4_0 | 128K | **25.9** | 224 / 279 / 289 | - |
| k8v4 | 128K | 29.9 | 202 / **236 / 233** | 228 / 214 |
| k8v4 + `--mtp-q4 all` | 128K | 31.2 | 203 / 239 / 235 | - |
| **k8v4 + `--kv-resident 32768`** | **128K** | **31.1** | **210 / 300 / 315** | **321 / 285** |
| k8v4 + KV streaming + `--mtp-q4 all` | 128K | 30.3 | 212 / 299 / 313 | - |
| `--prefill-head-alias` (+/- mtp-q4) | 128K | - | - | refuses to start: single GPU only |

The ~101K prompt reuses the ~63K prompt's first part from the prompt cache, so its number covers the fresh tokens at
positions 63K-101K. That is the same for both rows.

## Why it tops out near 31 tok/s: the decode profile

`STRATA_DECODE_TIMING=1`, steady state, 512-token answers: about **86 ms per verify window, 2.35 tokens per window**.

| Where the time goes | ms / window | share |
| --- | ---: | ---: |
| GPU work (card 1: layers 0-30 ~35 ms; card 2: layers 31-47 + head ~24 ms) | ~60 | ~70% |
| GPUs waiting for CPU experts | ~16 | ~19% |
| MTP draft | ~6 | ~7% |
| PCIe expert reads | ~2 | ~2% |

- The 1070's dense projections are memory-bandwidth bound (256 GB/s). The cards draw 50-120 W of their 151 W cap,
  so a higher power limit does nothing.
- Only 1,510 experts (2.8 GiB) fit in the two caches, a ~50% hit rate. The rest run on the CPU.
- The two cards take turns, because a layer split is a pipeline. `--pipeline-windows 2` is meant to overlap them,
  but on this pair the guessed windows did not pay.
- Faster GPUs, or more VRAM per GPU, is the lever. For comparison, Strata's community results list 2x RTX 3060 12 GB
  on an older Xeon at ~43 tok/s on IQ3_S (repeated-filler prompts).

## Why 128K needed KV streaming

The prompt path borrows expert-cache slots on each card to hold its chunk buffers. With k8v4 at 128K, the second
card (17 layers + the output head + the 876 MiB draft layer + its KV) had 614 slots left, so the automatic chunk fell
from 1,536 to 768 tokens, and long prompts slowed by about 25%. `--kv-resident 32768` keeps 32K cells per QSA
layer in VRAM and the rest in pinned RAM (0.70 GiB). The cache went back to 1,621 slots and prompt reading back to
the 64K level. Even at ~101K tokens, 92% of KV block reads hit VRAM (162 MiB read from RAM for that prompt).

## Did not help, or not tested

- Monitoring that calls `nvidia-smi` every 2-5 s: no cost (30.7 vs 31.0).
- Not tested: huge pages for the 47 GB expert arena (needs `vm.nr_hugepages`); `--batch N` slots (throughput for
  several clients, slower per request); `--kv-resident` values other than 32768; `strata tune auto`.
- This board has a dead memory channel (3 of 4 channels, DDR4-2133). A healthy quad-channel board should help
  the CPU-expert part a little.
