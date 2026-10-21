#!/usr/bin/env python3
"""Step 4: apply the measured winners to the run config that `strata launch` wrote.

    python3 04-apply-tuned-config.py ~/.local/state/strata/launch/flashnext-iq3s.json

What it sets (see results/README.md for every arm):
  --pcie-frac 0.10        cache misses mostly computed by the CPU instead of read over PCIe. The startup probe picks
                          0.33 from raw link speed (12.1 GB/s), but on a GTX 1070 each PCIe expert read costs more than
                          a 14-core Xeon computing it: 0.33 -> 27.2 tok/s, 0.10 -> ~31, 0.45 -> 25.4, 0.60 -> 22.1.
                          Exactly 0 loses the gain (27.2).
  --mtp-draft-vocab draft_vocab_en.bin   the English/code draft-head subset (~110 MiB less VRAM, +~1 tok/s). It only
                          changes what the draft layer proposes; the main model still verifies every token.
  --kv k8v4 --max-context 131072 --kv-resident 32768
                          128K context: INT8 K (exact attention scores) + 4-bit V, with KV streaming (32K cells per QSA
                          layer in VRAM, the rest in 0.7 GiB of pinned RAM). Without streaming, k8v4 at 128K shrinks
                          the auto prompt chunk 1536 -> 768 (card 2 runs out of expert-cache slots to lend) and long
                          prompts read at 214-236 tok/s; with it, 285-321 tok/s and the same ~31 tok/s decode.

A backup of the config is written next to it. `strata launch` regenerates this file from the preset, so serve it with
`strata serve --profile <this file>` (or the systemd unit in this folder) instead of re-running `strata launch`.
"""
import json, shutil, sys, time
from pathlib import Path

p = Path(sys.argv[1]).expanduser()
shutil.copy2(p, p.with_name(p.name + ".bak-" + time.strftime("%Y%m%d-%H%M%S")))
cfg = json.loads(p.read_text())
args = cfg["args"]
vocab = Path("~/.local/share/strata/terminal/current/data/draft_vocab_en.bin").expanduser()


def setf(flag, value):
    if flag in args:
        args[args.index(flag) + 1] = value
    else:
        args.extend([flag, value])


setf("--pcie-frac", "0.10")
setf("--mtp-draft-vocab", str(vocab))
setf("--kv", "k8v4")
setf("--max-context", "131072")
setf("--kv-resident", "32768")
p.write_text(json.dumps(cfg, indent=1))
p.chmod(0o600)                         # it may hold the server's API key
print("engine args now:", " ".join(a.rsplit("/", 1)[-1] if a.startswith("/") else a for a in args))
