# A/B log: Strata on 2x GTX 1070 (Oct 2026)

Every arm is in [`ab-runs.csv`](ab-runs.csv) (62 runs that completed; two more failed to start, noted below).
Harness: [`benchmarks/ab_bench.py`](../benchmarks/ab_bench.py).

## Method

- One test server per arm, started from a copy of the run config with one change. The serving instance is stopped
  so the arm has both cards to itself.
- Warm-up: one short request, then one 300-token answer so the adaptive expert cache settles.
- **Correctness first:** `17*23` -> `391`, capital of Australia -> `Canberra`, and an exact JSON echo. All 62 arms
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

## Rounds 8-10: GDDR5 memory offset

Start: the live 128K config above. Under CUDA, both cards sit in P2 with memory at 3802 MHz instead of the 4004 MHz
max. `nvmlDeviceSetMemClkVfOffset` (NVML, root, no X server) shifts that: the offset is in transfer-rate units, so
+200 = +100 MHz on the reported clock. Each arm first ran a VRAM pattern test on both cards
([`memtest.cu`](../recipe/memory-offset/memtest.cu): 6 GB, hash fill + verify, 60 s per card), then the usual bench.
The sweep stopped at the first VRAM error.

| Offset | P2 memory clock | Copy bandwidth | VRAM errors | Decode | Prompt 2K / 9K / 29K |
| --- | ---: | ---: | --- | ---: | --- |
| +0 (4 runs) | 3802 MHz | 204 GB/s | 0 | 30.6 / 31.1 / 28.9 / 31.6 (mean 30.6) | ~208 / 296 / 310 |
| +200 | 3898 | 210 | 0 | 31.3 | 209 / 297 / 308 |
| +400 | 3999 | 216 | 0 | 31.4 | 207 / 292 / 310 |
| +600 | 4100 | 222 | 0 | 31.7 | 208 / 294 / 311 |
| **+800 (2 runs)** | **4201** | **228** | **0 (also a 5-min soak per card)** | **31.8 / 33.3 (mean 32.6)** | **210 / 301 / 316** |
| +1000 | 4303 | 234 | 0 | 32.2 | 215 / 303 / 317 |
| +1200 | 4404 | 241 | **2 on one card** | not run | - |

- Bandwidth scaled linearly with the clock up to the failure, with no visible error-retry slowdown first, so the
  pattern test is the only warning. Decode gains about half of the bandwidth gain (+12% bandwidth -> +5-6% decode):
  the GPU stages are not purely bandwidth bound, and ~19% of a window waits on CPU experts anyway.
- Chosen: **+800** on both cards, 400 units below the first error. +1000 was clean but one step from failure and
  within noise of +800.
- Temperatures: no change vs stock. The warmer card sits at its 83 C target on long prompts either way; the VRAM
  stress test peaks at ~185 W.
- Run-to-run noise was wider than in rounds 1-7: the stock config gave 28.9-31.6 on the same day.

## Round 11: `--pcie-frac` around 0.10, with the memory offset

Interleaved, two runs each, on the live config with +800:

| `--pcie-frac` | Decode (2 runs) | Mean | Prompt 2K / 9K / 29K (first run) |
| --- | --- | ---: | --- |
| 0.05 | 31.7 / 31.7 | 31.7 | 210 / 297 / 315 |
| **0.10** | **32.2 / 32.5** | **32.35** | **215 / 309 / 325** |
| 0.15 | 31.6 / 29.2 | 30.4 | 208 / 294 / 314 |

0.10 stays. With rounds 2-4 (0.20 ~ 0.10, 0.45 and up clearly worse, 0 = no gain), the optimum on this pair is a
small but non-zero share of misses read over PCIe.

## Nov 2026: engine 0.1.56, the drafter, and the 512-token steady-state sweep

Raw data: the 512-token sweep is in `512-mtp-baseline.json`, `512-spec6.json`, `512-pcie035.json`,
`512-spec6-pcie035.json`, `512-pcie035-spec4.json`; the drafter A/B is in `ab-mtp-0156.json`,
`ab-mtp-0156-r2.json`, `ab-dflash2-0156.json`, `ab-df2-conf08.json`, `ab-df2-conf065.json`.

This section supersedes the ~31 tok/s headline for *steady-state decode* — see why below. The box moved from
Strata 0.2.1 (engine 0.1.46) to **engine 0.1.56 / Control 0.1.56**. Two things changed the numbers: the engine
upgrade itself, and a **longer measurement** (512-token steady-state vs the old 128-token sample, which included the
first-token ramp). The stock config (`--spec 4 --pcie-frac 0.10 --kv k8v4`, MTP drafter) now measures **47.5 tok/s
steady-state at a ~9.7K prompt** and **37.4 at ~2K**. That 47.5 is the box's honest steady-state ceiling on stock
config — the "~48" the operator remembered hitting at one point was this number, reproduced on purpose.

### Drafter: DFlash2 (new in 0.2.10) loses to MTP, decisively

DFlash2 is a ~0.7 GB Q4_0 drafter that replaces the 5.2 GB MTP layer. `strata drafting plan --mode dflash2`
reports `serves: true` on this CC 6.1 pair (the earlier "CC 6.1 unsupported → MTP fallback" assumption was wrong for
0.1.56; the caveat is `support: "untested"`). A/B'd live at `--parallel 1`, 2K/8K prompt, 128-token decode:

| Drafter | Decode @2K | Decode @8K | Draft accept |
| --- | ---: | ---: | --- |
| **MTP (`--spec 4`)** | **36.9** | **46.1** | 96/96 (100%) |
| DFlash2 (`--draft-conf 0.35`) | 34.4 | 41.2 | 95% |
| DFlash2 (`--draft-conf 0.8`) | 35.2 | 41.5 | 99% |
| DFlash2 (`--draft-conf 0.65`) | 34.9 | 41.3 | 99% |

DFlash2 drafts *more* tokens but at *lower* acceptance, so net decode throughput is worse by ~5-12%. Tuning
`--draft-conf` raised acceptance (95%→99%) but decode barely moved (+2%, noise) — on this PCIe-starved pair the
bottleneck is expert traffic, not draft acceptance. Both drafters were also given `strata tune auto`: MTP →
`default_confirmed` (base 29.3 cold, nothing faster), DFlash2 → `default_confirmed` (base 25.5 cold, nothing faster).
**Drafter is closed: MTP, `--spec 4 --spec-min-p 0.5`.**

### Single-stream sweep (512-token steady-state): stock config wins

Harness: [`benchmarks/hbench512.py`](../benchmarks/hbench512.py) (512-token completions so the ramp is diluted to ~12%
of the sample; `timings.predicted_per_second` over the full completion *is* the steady-state number at this length).
All arms on the same warm server, `--parallel 1`, MTP drafter:

| Config | Decode @~2K | Decode @~9.7K | Draft accept |
| --- | ---: | ---: | --- |
| **stock (`--spec 4 --pcie-frac 0.10`)** | **37.4** | **47.5** | 100% / 100% |
| `--spec 6 --pcie-frac 0.10` | 33.7 | 43.5 | 98% / 100% |
| `--spec 4 --pcie-frac 0.35` | 32.6 | 42.4 | 100% / 100% |
| `--spec 6 --pcie-frac 0.35` | 29.3 | 38.6 | 99% / 100% |

- **`--spec 6` is net-negative.** The wider MTP window drafts more tokens (195→220) at lower acceptance (100%→98%),
  and the 6-token verify capture costs more VRAM + compute per round. On this PCIe-bound card the extra verify work
  outweighs the saved round-trips. MTP is capped at `--spec 4` here — `tune auto` held it for the same reason.
- **`--pcie-frac 0.35` is net-negative (47.5→42.4).** Counterintuitive vs the Oct sweep, where 0.10 beat 0.0 and 0.45.
  At 0.35 the engine routes *more* of the expert cache over the link to the slower card, trading a fast-GPU cache for a
  slow one. (See the PCIe 1.0 finding below — the whole `--pcie-frac` curve may shift at Gen3.)
- **The combo is the worst** (29.3 / 38.6).
- **Verdict: stock config is the measured winner at 47.5.** 50 tok/s is not reachable via the drafter or the
  PCIe/kv knobs — both swept, both net-negative. Exceeding 47.5 needs a *structural* change (a different layer split /
  expert-cache shape, or the PCIe link recovered to Gen3), not a tuning knob.

### Why 47.5 now vs 31 before (the two are different measurements)

The Oct "31 tok/s" was a **128-token sample** that includes the first-token ramp and a cold-ish expert cache, on
**engine 0.1.46**. The Nov "47.5" is a **512-token steady-state** on **engine 0.1.56**, where the ramp is a small
fraction and the cache is warm. The *short-prompt* steady-state (37.4 @ ~2K) is closer to the old number; the
*long-prompt* steady-state (47.5 @ ~9.7K) is the box's true decode ceiling. They are not the same yardstick, so do not
read 47.5 as a 50% jump from 31 — it is the same box measured over a longer, warmer window on a newer engine.

### New finding: both cards negotiate PCIe 1.0, not Gen3

`lspci -vv` (2026-11-03): `LnkCap: Speed 8GT/s, Width x16` but `LnkSta: Speed 2.5GT/s (downgraded), Width x16` on
**both** 1070s. 2.5 GT/s is PCIe 1.0 (~1 GB/s) — 12× narrower than the Gen3 12.1 GB/s the Oct profile assumed. This
contradicts the Machine table and item #1 in the README. The 47.5 ceiling and the `--pcie-frac 0.10` optimum were both
measured on a 1.0 link, so **both may move if the link recovers to Gen3** (reseat / move to the topmost slots / force
Gen3 in BIOS). Not yet re-benched. See NOTES.md item 10.

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
- Huge pages: the 47 GB expert arena already gets transparent huge pages (~49 GB `AnonHugePages` while serving),
  so `vm.nr_hugepages` was not tried. Not tested: `--batch N` slots (throughput for
  several clients, slower per request); `--kv-resident` values other than 32768; `strata tune auto`.
- This board has a dead memory channel (3 of 4 channels, DDR4-2133). A healthy quad-channel board should help
  the CPU-expert part a little.
