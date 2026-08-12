import json
import os
import threading
import re
import time
import datetime

import requests
from bs4 import BeautifulSoup

DATA_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.json")
REFRESH_INTERVAL = 6 * 3600

FALLBACK = [
    {"id": "openai/gpt-4o-mini", "name": "GPT-4o mini (OpenAI)", "provider": "OpenAI", "input": 0.15, "output": 0.60, "context": 128000},
    {"id": "openai/gpt-5-nano", "name": "GPT-5 nano (OpenAI)", "provider": "OpenAI", "input": 1.25, "output": 10.0, "context": 400000},
    {"id": "anthropic/claude-3-5-haiku", "name": "Claude 3.5 Haiku (Anthropic)", "provider": "Anthropic", "input": 0.80, "output": 4.00, "context": 200000},
    {"id": "deepseek/deepseek-chat", "name": "DeepSeek V3 Chat", "provider": "DeepSeek", "input": 0.27, "output": 1.10, "context": 64000},
    {"id": "deepseek/deepseek-reasoner", "name": "DeepSeek R1 (Reasoner)", "provider": "DeepSeek", "input": 0.55, "output": 2.19, "context": 64000},
    {"id": "google/gemini-2.0-flash", "name": "Gemini 2.0 Flash (Google)", "provider": "Google", "input": 0.10, "output": 0.40, "context": 1000000},
    {"id": "moonshotai/kimi-k2", "name": "Kimi K2 (Moonshot)", "provider": "Moonshot", "input": 0.60, "output": 2.50, "context": 131072},
    {"id": "z-ai/glm-4", "name": "GLM-4 (Zhipu)", "provider": "Zhipu", "input": 0.10, "output": 0.10, "context": 128000},
    {"id": "groq/llama-3.3-70b-versatile", "name": "Llama 3.3 70B (Groq)", "provider": "Groq", "input": 0.59, "output": 0.79, "context": 128000},
    {"id": "mistralai/mistral-small", "name": "Mistral Small (Mistral)", "provider": "Mistral", "input": 0.10, "output": 0.30, "context": 32000},
    {"id": "cohere/command-r-plus", "name": "Command R+ (Cohere)", "provider": "Cohere", "input": 2.50, "output": 10.00, "context": 128000},
    {"id": "qwen/qwen2.5-72b-instruct", "name": "Qwen2.5 72B (Alibaba)", "provider": "Alibaba", "input": 1.40, "output": 1.40, "context": 131072},
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

_session_lock = threading.Lock()
_session = requests.Session()
_session.headers.update(HEADERS)


def _http_get(url, timeout=12, headers=None):
    with _session_lock:
        if headers:
            resp = _session.get(url, timeout=timeout, headers=headers)
        else:
            resp = _session.get(url, timeout=timeout)
        resp.raise_for_status()
        return resp


def _or_headers():
    headers = dict(HEADERS)
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if api_key:
        headers["Authorization"] = "Bearer " + api_key
    return headers, api_key


def fetch_openrouter():
    headers, _ = _or_headers()
    data = _http_get("https://openrouter.ai/api/v1/models", timeout=15, headers=headers).json()
    out = []
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    for m in data.get("data", []):
        p = m.get("pricing", {})
        try:
            inp = float(p.get("prompt")) * 1_000_000
            out_p = float(p.get("completion")) * 1_000_000
        except (TypeError, ValueError):
            continue
        if inp <= 0 and out_p <= 0:
            continue
        name = m.get("name", m.get("id", ""))
        id_ = m.get("id", "")
        key = "Unknown"
        if id_ and "/" in id_:
            key = id_.split("/", 1)[0]
        key_low = key.lower()
        for probe, disp in (
            ("openai", "OpenAI"), ("anthropic", "Anthropic"),
            ("google", "Google"), ("deepseek", "DeepSeek"),
            ("moonshot", "Moonshot"), ("kimi", "Moonshot"),
            ("mistral", "Mistral"), ("meta", "Meta"),
            ("alibaba", "Alibaba"), ("qwen", "Alibaba"),
            ("z-ai", "Zhipu"), ("zhipu", "Zhipu"), ("bigmodel", "Zhipu"),
            ("groq", "Groq"), ("cohere", "Cohere"),
            ("amazon", "Amazon"), ("aws", "Amazon"),
            ("microsoft", "Microsoft"), ("inclusionai", "InclusionAI"),
            ("perplexity", "Perplexity"), ("x-ai", "xAI"),
            ("grok", "xAI"), ("gemini", "Google"), ("nvidia", "NVIDIA"),
        ):
            if probe in key_low:
                key = disp
                break
        tp = m.get("top_provider") or {}
        bm = (m.get("benchmarks") or {}).get("artificial_analysis") or {}
        tps = None
        ttft = None
        cache_in = None
        try:
            cv = p.get("input_cache_read")
            if cv is not None and str(cv).strip() and float(cv) > 0:
                cache_in = float(cv) * 1_000_000
        except (TypeError, ValueError):
            cache_in = None
        out.append({
            "id": id_,
            "name": "{} ({})".format(name, key),
            "provider": key,
            "input": inp,
            "output": out_p,
            "context": int((m.get("context_length") or 0)),
            "cache_in": cache_in,
            "intel": bm.get("intelligence_index"),
            "code": bm.get("coding_index"),
            "agentic": bm.get("agentic_index"),
            "tps": tps,
            "ttft": ttft,
            "updated": now,
        })
    return out


def fetch_throughput_rank():
    headers, api_key = _or_headers()
    data = _http_get(
        "https://openrouter.ai/api/v1/models?sort=throughput-high-to-low",
        timeout=15, headers=headers,
    ).json()
    ids = [m.get("id") for m in data.get("data", []) if m.get("id")]
    return {mid: (i, len(ids)) for i, mid in enumerate(ids)}


def _parse_usd(text):
    m = re.search(r"([\$￥¥])\s?(\d+(?:\.\d+)?)\s?(?:per|/|\s)(?:1M|million|M)\s+tokens", text, re.I)
    if not m:
        m = re.search(r"(\d+(?:\.\d+)?)\s?(?:per|/)\s?(?:1M|million|M)\s+tokens", text, re.I)
    if m:
        return float(m.group(1).strip("$￥¥"))
    return None


def scrape_deepseek():
    html = _http_get("https://api-docs.deepseek.com/quick_start/pricing", timeout=6).text
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text(" ", strip=True)
    prices = re.findall(r"\$\s?(\d+(?:\.\d+)?)", text)
    if not prices:
        return []
    rows = []
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    if len(prices) >= 4:
        rows.append({"id": "deepseek/deepseek-chat", "name": "DeepSeek V3",
                     "provider": "DeepSeek", "input": float(prices[0]), "output": float(prices[1]),
                     "context": 64000, "updated": now})
        rows.append({"id": "deepseek/deepseek-reasoner", "name": "DeepSeek R1",
                     "provider": "DeepSeek", "input": float(prices[2]), "output": float(prices[3]),
                     "context": 64000, "updated": now})
    return rows


def fetch_all():
    results = []
    errors = []
    for fn in (fetch_openrouter, scrape_deepseek):
        try:
            got = fn()
            if got:
                results.extend(got)
        except Exception as exc:
            errors.append("{}: {}".format(fn.__name__, str(exc)[:120]))
    if not results:
        results = [dict(FALLBACK[i]) for i in range(len(FALLBACK))]
        for it in results:
            it["updated"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        errors.append("all sources failed, using built-in fallback")
    return results, errors


def _dedupe(items):
    seen = {}
    order = []
    for it in items:
        k = it.get("id")
        if k and k not in seen:
            seen[k] = it
            order.append(k)
    return [seen[k] for k in order]


def load_cache():
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def save_cache(payload):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


HISTORY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "history.json")
HISTORY_KEEP_DAYS = 45


def load_history():
    try:
        with open(HISTORY_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    data.pop("_last_backfill", None)
    return data


def save_history(history):
    with open(HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False)


def record_history(items):
    history = load_history()
    today = datetime.date.today().isoformat()
    for it in items:
        mid = it.get("id")
        if not mid or it.get("input") is None:
            continue
        entries = history.setdefault(mid, [])
        entry = {"date": today, "input": it["input"], "output": it.get("output")}
        if entries and entries[-1]["date"] == today:
            entries[-1] = entry
        else:
            entries.append(entry)
        if len(entries) > HISTORY_KEEP_DAYS:
            history[mid] = entries[-HISTORY_KEEP_DAYS:]
    save_history(history)


def get_history(model_id, days):
    history = load_history()
    entries = history.get(model_id, [])
    if days >= HISTORY_KEEP_DAYS:
        return entries
    cutoff = (datetime.date.today() - datetime.timedelta(days=days - 1)).isoformat()
    return [e for e in entries if e["date"] >= cutoff]


def history_deltas(days):
    history = load_history()
    cutoff = (datetime.date.today() - datetime.timedelta(days=days - 1)).isoformat()
    out = {}
    for mid, entries in history.items():
        pts = [e for e in entries if e["date"] >= cutoff]
        if len(pts) >= 2:
            first, last = pts[0], pts[-1]

            def pct(a, b):
                if not a or b in (None, 0):
                    return None
                return round(float(a) / float(b) * 100 - 100, 1)

            out[mid] = {
                "in_pct": pct(last.get("input"), first.get("input")),
                "out_pct": pct(last.get("output"), first.get("output")),
                "in_first": first.get("input"),
                "in_last": last.get("input"),
                "out_first": first.get("output"),
                "out_last": last.get("output"),
                "first": first["date"],
                "last": last["date"],
            }
    return out


def history_stats():
    history = load_history()
    dates = set()
    models = 0
    points = 0
    for mid, entries in history.items():
        if not isinstance(entries, list) or not entries:
            continue
        models += 1
        for e in entries:
            if isinstance(e, dict) and e.get("date"):
                dates.add(e["date"])
                points += 1
    first = min(dates) if dates else None
    last = max(dates) if dates else None
    return {"days": len(dates), "models": models, "points": points, "first": first, "last": last}


BACKFILL_PAGES = {
    "api-docs.deepseek.com/quick_start/pricing": [
        "deepseek/deepseek-chat",
        "deepseek/deepseek-reasoner",
    ],
}


def maybe_backfill():
    try:
        with open(HISTORY_FILE, "r", encoding="utf-8") as f:
            raw = json.load(f)
    except (OSError, ValueError):
        raw = None
    if raw and raw.get("_last_backfill") == datetime.date.today().isoformat():
        return
    try:
        dates = set()
        for mid, entries in raw.items() if raw else []:
            if isinstance(entries, list):
                for e in entries:
                    if isinstance(e, dict) and e.get("date"):
                        dates.add(e["date"])
        do_backfill = len(dates) <= 10
    except Exception:
        do_backfill = True
    if not do_backfill:
        return
    try:
        ok = wayback_backfill()
        history = load_history()
        history["_last_backfill"] = datetime.date.today().isoformat()
        save_history(history)
        return ok
    except Exception:
        return False


def _row_model_id(row_text):
    t = row_text.lower()
    for key, mid in (
        ("deepseek-chat", "deepseek/deepseek-chat"),
        ("deepseek-reasoner", "deepseek/deepseek-reasoner"),
        ("deepseek r1", "deepseek/deepseek-reasoner"),
        ("v3", "deepseek/deepseek-chat"),
        ("deepseek-v3", "deepseek/deepseek-chat"),
    ):
        if key in t:
            return mid
    return None


def _monies(text):
    out = []
    for m in re.finditer(r"(?:USD\s*)?\$?\s?(\d+(?:\.\d+)?)\s*(?:USD|per|/)?", text, re.I):
        out.append(float(m.group(1)))
    return out


def wayback_backfill():
    did = False
    today = datetime.date.today()
    since = (today - datetime.timedelta(days=31)).strftime("%Y%m%d")
    for page, model_ids in BACKFILL_PAGES.items():
        try:
            r = _http_get(
                "https://web.archive.org/cdx/search/cdx?url={}&output=text&fl=timestamp"
                "&filter=statuscode:200&from={}&to={}&limit=90".format(page, since, today.strftime("%Y%m%d")),
                timeout=10,
            )
            snaps = [line.split() for line in r.text.splitlines() if line.strip()]
        except Exception:
            continue
        for parts in snaps[-12:]:
            ts = parts[0]
            if not ts.isdigit():
                continue
            pdate = datetime.datetime.strptime(ts[:8], "%Y%m%d").date()
            try:
                html = _http_get("https://web.archive.org/web/{}/id_/https://{}".format(ts, page), timeout=15).text
            except Exception:
                continue
            soup = BeautifulSoup(html, "html.parser")
            history = load_history()
            found = False
            for table in soup.find_all("table"):
                for tr in table.find_all("tr"):
                    row_text = tr.get_text(" ", strip=True)
                    if "$" not in row_text and "USD" not in row_text:
                        continue
                    mid = _row_model_id(row_text)
                    if mid is None or mid not in model_ids:
                        continue
                    monies = [m for m in _monies(row_text) if 0 < m < 5000]
                    if len(monies) >= 2:
                        entries = history.setdefault(mid, [])
                        entry = {"date": pdate.isoformat(), "input": min(monies[0], monies[1]), "output": max(monies[0], monies[1])}
                        if (not entries) or entries[-1]["date"] < entry["date"]:
                            entries.append(entry)
                            if len(entries) > HISTORY_KEEP_DAYS:
                                history[mid] = entries[-HISTORY_KEEP_DAYS:]
                            found = True
                            did = True
            if found:
                save_history(history)
    return did


FALLBACK_MARKER = "all sources failed, using built-in fallback"

AA_PERF_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "aa_perf.json")
AA_PERF_MAX_AGE = 30 * 24 * 3600  # AA 性能缓存有效期（秒），30 天内不重复抓取
AA_PAGE = "https://artificialanalysis.ai/models/claude-opus-5"
AA_SUFFIX = ("-non-reasoning", "-thinking", "-adaptive", "-xhigh", "-high", "-medium",
             "-low", "-minimal", "-flash", "-ultra", "-max", "-pro", "-fast", "-preview")
AA_OR_SUFFIX = ("-fast", "-pro", "-ultra", "-max", "-mini", "-image", "-omni",
                "-thinking", "-non-reasoning", "-ehance", "-improved")


def _aa_de_suffix(s):
    changed = True
    while changed:
        changed = False
        for sfx in AA_SUFFIX:
            if s.endswith(sfx) and len(s) > len(sfx) + 2:
                s = s[: -len(sfx)]
                changed = True
                break
    return s


def _aa_bare(s):
    s = (s or "").lower().strip("~")
    s = re.sub(r":\w+$", "", s)
    s = _aa_de_suffix(s)
    s = re.sub(r"[\s_.\-]+", "", s)
    return s


def _aa_or_attempts(seg):
    base = re.sub(r":\w+$", "", seg).lower().strip("~")
    yield re.sub(r"[\s_.\-]+", "", base)
    s = base
    changed = True
    while changed:
        changed = False
        for sfx in AA_OR_SUFFIX:
            if s.endswith(sfx) and len(s) > len(sfx) + 2:
                s = s[: -len(sfx)]
                changed = True
                break
    if s != base:
        yield re.sub(r"[\s_.\-]+", "", s)
    s2 = re.sub(r"-\d{2,4}$", "", base)
    if s2 != base:
        yield re.sub(r"[\s_.\-]+", "", s2)


def fetch_aa_perf():
    """从 AA 官网详情页内嵌数据抓取性能评测（吞吐/首 token 时间，无需 key）。

    页面（约 3MB，任意详情页均内嵌全量模型库）中有一段转义 JSON
    "models":[...]。tps 取 outputSpeedVariance.median（输出 tokens/s）；
    ttft 取 timeToFirstAnswerToken.total（秒，收到首个答案 token 的时间），
    统一转为毫秒以对齐既有 ttft 单位。返回 {bare_slug: {"tps":..,"ttft":..}}；
    失败返回 None（调用方负责缓存兜底）。
    """
    html = _http_get(AA_PAGE, timeout=60).text
    idx = html.find('\\"models\\":[')
    if idx < 0:
        raise ValueError("AA page: models array not found")
    start = html.find("[", idx)
    depth = 0
    j = None
    for p in range(start, len(html)):
        c = html[p]
        if c == "[":
            depth += 1
        elif c == "]":
            depth -= 1
            if depth == 0:
                j = p
                break
    if j is None:
        raise ValueError("AA page: unbalanced array")
    arr = json.loads(html[start:j + 1].replace(r"\"", '"'))
    out = {}
    for m in arr:
        if not isinstance(m, dict) or not m.get("slug"):
            continue
        sl = _aa_bare(m.get("slug"))
        if not sl:
            continue
        new_tps = None
        vs = m.get("outputSpeedVariance")
        if isinstance(vs, dict) and isinstance(vs.get("median"), (int, float)):
            new_tps = float(vs["median"])
        new_ttft = None
        tfa = m.get("timeToFirstAnswerToken")
        if isinstance(tfa, dict) and isinstance(tfa.get("total"), (int, float)):
            new_ttft = round(float(tfa["total"]) * 1000, 1)
        old = out.get(sl)
        if old is None:
            out[sl] = {"tps": new_tps, "ttft": new_ttft}
        else:
            if old["tps"] is None and new_tps is not None:
                old["tps"] = new_tps
            if old["ttft"] is None and new_ttft is not None:
                old["ttft"] = new_ttft
    return out


def load_aa_perf():
    try:
        with open(AA_PERF_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return None
    if isinstance(data, dict) and "models" in data:
        return data
    if isinstance(data, dict) and data and all(
            isinstance(v, dict) for v in data.values()):
        return {"fetched_at": None, "models": data}
    return None


def save_aa_perf(data):
    with open(AA_PERF_FILE, "w", encoding="utf-8") as f:
        json.dump({
            "fetched_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "models": data,
        }, f, ensure_ascii=False)


def merge_aa_perf(items, perf):
    """把 AA 性能按 id 匹配补进 items（tps/ttft，仅当现值为空时补），补入的打 aa_perf 标记。

    perf 为 {bare_slug: {"tps":..,"ttft":..}}；返回 (补了几个, 匹配个数)。
    """
    if not perf:
        return 0, 0
    filled = 0
    matched_ids = 0
    for it in items:
        oid = it.get("id") or ""
        seg = oid.split("/", 1)[1] if "/" in oid else oid
        for cand in _aa_or_attempts(seg):
            rec = perf.get(cand)
            if rec:
                matched_ids += 1
                if it.get("tps") is None and rec.get("tps") is not None:
                    it["tps"] = rec["tps"]
                    it["aa_perf"] = True
                    filled += 1
                if it.get("ttft") is None and rec.get("ttft") is not None:
                    it["ttft"] = rec["ttft"]
                    it["aa_perf"] = True
                    filled += 1
                break
    return filled, matched_ids


def collect():
    items, errors = fetch_all()
    items = _dedupe(items)
    fell_back = any(FALLBACK_MARKER in str(e) for e in errors)
    prev = load_cache() or {}
    prev_map = {it.get("id"): it for it in (prev.get("items") or []) if it.get("id")}
    for it in items:
        old = prev_map.get(it.get("id"))
        if not old:
            continue
        for k in ("intel", "code", "agentic"):
            if it.get(k) is None and old.get(k) is not None:
                it[k] = old[k]
                it["idx_fallback"] = True
    cached = load_aa_perf()
    perf_used_at = None
    fresh = False
    if cached:
        try:
            fetched = datetime.datetime.fromisoformat(cached["fetched_at"])
            age = (datetime.datetime.now(datetime.timezone.utc) - fetched).total_seconds()
            fresh = age <= AA_PERF_MAX_AGE
        except (ValueError, TypeError, KeyError):
            fresh = False
    if fresh:
        perf_used_at = cached["fetched_at"]
        merge_aa_perf(items, cached["models"])
    else:
        try:
            new = fetch_aa_perf()
            if new:
                perf_used_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
                save_aa_perf(new)
                merge_aa_perf(items, new)
            else:
                raise ValueError("empty aa perf response")
        except Exception as exc:
            if cached:
                perf_used_at = cached["fetched_at"]
                try:
                    merge_aa_perf(items, cached["models"])
                except Exception:
                    pass
            else:
                errors.append("aa_perf: fetch failed and no cache ({})".format(str(exc)[:60]))
    try:
        tp_rank = fetch_throughput_rank()
    except Exception as exc:
        tp_rank = {}
        errors.append("throughput rank: {}".format(str(exc)[:80]))
    n = max((v[1] for v in tp_rank.values()), default=1)
    for it in items:
        r = tp_rank.get(it.get("id"))
        if r:
            it["speed_rank"] = r[0] + 1
            it["speed_pct"] = round(100 * (1 - r[0] / n), 1)
        else:
            it["speed_rank"] = None
            it["speed_pct"] = None
    items.sort(key=lambda x: (x["input"], x["output"]))
    if not fell_back:
        record_history(items)
    else:
        errors.append(
            "all sources failed: history snapshot skipped to avoid polluting trend data"
        )
    maybe_backfill()
    return {
        "updated": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "items": items,
        "errors": errors,
        "aa_perf_at": perf_used_at,
    }


class Refresher(threading.Thread):
    def __init__(self):
        super().__init__(daemon=True)
        self._lock = threading.Lock()
        self._last = None
        self._refreshing = False
        self._running = True

    def ensure(self):
        with self._lock:
            stale = self._last is None or (
                time.time() - self._last > REFRESH_INTERVAL
            )
            refreshing = self._refreshing
        if stale and not refreshing:
            self.refresh_async()

    def refresh_async(self):
        with self._lock:
            if self._refreshing:
                return
            self._refreshing = True
        threading.Thread(target=self._sync, daemon=True).start()

    def _sync(self):
        try:
            payload = collect()
            save_cache(payload)
        finally:
            with self._lock:
                self._refreshing = False
                self._last = time.time()

    def refresh(self):
        with self._lock:
            self._refreshing = True
        try:
            payload = collect()
            save_cache(payload)
            return payload
        finally:
            with self._lock:
                self._refreshing = False
                self._last = time.time()

    def run(self):
        while self._running:
            self.ensure()
            time.sleep(600)