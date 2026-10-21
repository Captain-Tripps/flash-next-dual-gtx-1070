#!/usr/bin/env python3
"""Strata A/B bench: start a test server from a copy of a run config, warm up, check answers, measure decode + prompt.

    python3 ab_bench.py --config RUN_CONFIG.json --docs STRATA_CHECKOUT/docs --name ARM \
        [--args "--flag v ..."] [--drop "--flag"] [--env K=V ...] [--quick | --long]

RUN_CONFIG.json is the run config `strata launch` writes (~/.local/state/strata/launch/<preset>.json) or setup's
strata-<model>.json. Each arm is that config with --args added/replaced and --drop removed; the copy, the server log and
the result go to ~/strata-tune/{cfgs,logs,results}/<ARM>.*. The test server listens on 127.0.0.1:8081, so stop the
serving instance first (both need the cards). The API key is read from the config and never printed.

--docs: any folder of .md files used as filler text for the long prompts (a Strata checkout's docs/ is what the
published numbers used). --quick skips the ~29K-token prompt; --long runs only the ~63K / ~101K prompts.
"""
import argparse, json, os, shlex, signal, statistics, subprocess, sys, time, urllib.request, urllib.error
from pathlib import Path

HOME = Path.home()
BASE_CFG = None          # --config
STRATA = Path(os.environ.get("STRATA_BIN", HOME / ".local/bin/strata"))
TUNE = HOME / "strata-tune"
PORT = 8081
DOCS = None              # --docs

CHECKS = [("What is 17*23? Answer with just the number.", "391"),
          ("What is the capital of Australia? One word.", "Canberra"),
          ('Reply with only this JSON and nothing else: {"ok": true, "n": 3}', '{"ok": true, "n": 3}')]
DECODE = [("chat", "Explain in about 250 words how a refrigerator moves heat out of its inside."),
          ("code", "Write a Python class LRUCache with get and put in O(1) using a dict and a doubly linked list, with docstrings."),
          ("prose", "Write a short story of about 300 words about a lighthouse keeper who finds a message in a bottle.")]


def set_args(args, add, drop):
    out = list(args)
    for flag in drop:
        while flag in out:
            i = out.index(flag)
            nxt = out[i + 1] if i + 1 < len(out) else None
            del out[i]
            if nxt is not None and not nxt.startswith("--"):
                del out[i]
    toks = shlex.split(add)
    i = 0
    while i < len(toks):
        flag = toks[i]
        val = toks[i + 1] if i + 1 < len(toks) and not toks[i + 1].startswith("--") else None
        if flag in out:
            j = out.index(flag)
            if val is not None and j + 1 < len(out) and not out[j + 1].startswith("--"):
                out[j + 1] = val
            elif val is not None:
                out.insert(j + 1, val)
        else:
            out += [flag] + ([val] if val is not None else [])
        i += 2 if val is not None else 1
    return out


def post(key, body, timeout=1800):
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}/v1/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        d = json.load(r)
    d["_wall"] = time.time() - t0
    return d


def ask(key, text, max_tokens, think=True):
    body = {"model": "x", "messages": [{"role": "user", "content": text}], "max_tokens": max_tokens, "temperature": 0}
    if not think:
        body["chat_template_kwargs"] = {"enable_thinking": False}
    d = post(key, body)
    m = d["choices"][0]["message"]
    t = d.get("timings", {})
    return {"content": m.get("content") or "", "prompt_tokens": d.get("usage", {}).get("prompt_tokens"),
            "gen_tokens": d.get("usage", {}).get("completion_tokens"), "pp": t.get("prompt_per_second"),
            "tg": t.get("predicted_per_second"), "wall": round(d["_wall"], 1)}


def long_text(n_chars):
    docs = [f.read_text(encoding="utf-8", errors="ignore") for f in sorted(DOCS.glob("*.md"))]
    parts, i = [], 0
    while sum(map(len, parts)) <= n_chars:          # cycle the docs when a prompt needs more than they hold
        parts.append(f"\n\n[part {i}]\n" + docs[i % len(docs)])
        i += 1
    return "".join(parts)[:n_chars]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True, type=Path, help="the run config to copy for every arm")
    ap.add_argument("--docs", required=True, type=Path, help="folder of .md files used as long-prompt filler")
    ap.add_argument("--name", required=True)
    ap.add_argument("--args", default="")
    ap.add_argument("--drop", action="append", default=[])
    ap.add_argument("--env", action="append", default=[])
    ap.add_argument("--quick", action="store_true", help="skip the 24K prompt")
    ap.add_argument("--long", action="store_true", help="only the long prompts: ~60K and ~100K tokens (no decode set)")
    ap.add_argument("--boot", type=int, default=900)
    a = ap.parse_args()
    global DOCS
    DOCS = a.docs.expanduser()

    cfg = json.loads(a.config.expanduser().read_text())
    key = cfg.get("api_key") or "none"
    cfg["args"] = set_args(cfg["args"], a.args, a.drop)
    if a.env:
        cfg["env"] = dict(cfg.get("env") or {}, **dict(e.split("=", 1) for e in a.env))
    cfg["port"] = PORT
    cfg["log"] = str(TUNE / "logs" / f"{a.name}.engine.log")
    (TUNE / "cfgs").mkdir(parents=True, exist_ok=True)
    (TUNE / "results").mkdir(parents=True, exist_ok=True)
    (TUNE / "logs").mkdir(parents=True, exist_ok=True)
    cpath = TUNE / "cfgs" / f"{a.name}.json"
    cpath.write_text(json.dumps(cfg, indent=1))
    os.chmod(cpath, 0o600)
    logf = open(TUNE / "logs" / f"{a.name}.log", "w")
    env = dict(os.environ, CUDA_DEVICE_ORDER="PCI_BUS_ID")
    proc = subprocess.Popen([str(STRATA), "serve", "--profile", str(cpath), "--host", "127.0.0.1", "--port", str(PORT),
                             "--parallel", "1"], stdout=logf, stderr=subprocess.STDOUT, env=env, start_new_session=True)
    res = {"name": a.name, "args": a.args, "drop": a.drop, "env": a.env, "engine_args": cfg["args"]}
    try:
        t0 = time.time()
        while True:
            if proc.poll() is not None:
                raise SystemExit(f"server exited during start (code {proc.returncode}); see logs/{a.name}.log")
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{PORT}/health", timeout=3)
                break
            except Exception:
                if time.time() - t0 > a.boot:
                    raise SystemExit("server did not become healthy")
                time.sleep(3)
        res["boot_s"] = round(time.time() - t0)
        ask(key, "Say hello in five words.", 64)                         # warm-up
        ask(key, DECODE[0][1], 300)                                      # warm the adaptive expert tier
        res["checks"] = []
        for q, want in CHECKS:
            r = ask(key, q, 400)
            res["checks"].append({"want": want, "got": r["content"].strip()[:80], "ok": r["content"].strip() == want})
        dec = {}
        for tag, q in ([] if a.long else DECODE):
            runs = [ask(key, q, 512) for _ in range(2)]
            dec[tag] = {"tg": [r["tg"] for r in runs], "gen": [r["gen_tokens"] for r in runs],
                        "same": runs[0]["content"] == runs[1]["content"], "head": runs[0]["content"][:60]}
        res["decode"] = dec
        res["tg_median"] = round(statistics.median(x for d in dec.values() for x in d["tg"]), 1) if dec else 0.0
        pp = {}
        sizes = [("60k", 197000), ("100k", 328000)] if a.long else \
            [("2k", 8000), ("8k", 32000)] + ([] if a.quick else [("24k", 96000)])
        for tag, chars in sizes:
            r = ask(key, long_text(chars) + "\n\nIn one sentence: what is this text about?", 48, think=False)
            pp[tag] = {"prompt_tokens": r["prompt_tokens"], "pp": r["pp"], "tg_after": r["tg"], "wall": r["wall"]}
        res["prompt"] = pp
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(90)
        except Exception:
            os.killpg(proc.pid, signal.SIGKILL)
        logf.close()
    lines = []
    for f in (TUNE / "logs" / f"{a.name}.log", TUNE / "logs" / f"{a.name}.engine.log"):
        if f.exists():
            lines += open(f, errors="ignore").readlines()
    hit = [l for l in lines if "decode expert cache hit rate" in l]
    res["last_hit_line"] = hit[-1].strip()[-140:] if hit else None
    fill = [l for l in lines if "filling the GPU" in l or ("expert cache" in l and "slots," in l)]
    res["fill"] = fill[-1].strip()[-70:] if fill else None
    free = [l for l in lines if "VRAM free with everything loaded" in l]
    res["vram_free"] = free[-1].strip()[-50:] if free else None
    (TUNE / "results" / f"{a.name}.json").write_text(json.dumps(res, indent=1))
    ok = all(c["ok"] for c in res["checks"])
    print(f"{a.name:24s} checks={'OK' if ok else 'FAIL'} tg_med={res['tg_median']:5.1f} "
          + " ".join(f"{k}={v['tg']}" for k, v in res["decode"].items())
          + " | pp " + " ".join(f"{k}:{v['prompt_tokens']}@{v['pp']}" for k, v in res["prompt"].items())
          + f" | {res['fill']} | {res['vram_free']} | boot {res['boot_s']}s\n  {res['last_hit_line']}")
    if not ok:
        print("  checks:", res["checks"])


if __name__ == "__main__":
    main()
