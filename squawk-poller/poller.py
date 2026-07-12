#!/usr/bin/env python3
"""
Tradeaholiks squawk poller — Phase 1 (Trump + Fed).

Every 60 seconds:
  - checks trumpstruth.org's RSS feed for new Trump Truth Social posts
    (falls back to CNN's public JSON archive if trumpstruth blocks/fails
    3 times in a row),
  - checks the Federal Reserve's monetary-policy press feed,
  - inserts anything NEW into the Supabase `alerts` table (deduped by a
    text hash, so the same post from two mirrors is only announced once),
  - once an hour, deletes alerts older than 48 hours.

First run "seeds": it memorises everything currently in the feeds WITHOUT
announcing it, so switching the poller on never reads out old posts.
State (seen hashes) persists in /data/seen.json across restarts.

Env vars (from .env): SUPABASE_URL, SUPABASE_SERVICE_KEY
"""

import hashlib
import html
import json
import os
import re
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

import requests

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

TRUMP_RSS = "https://trumpstruth.org/feed"
CNN_JSON = "https://ix.cnn.io/data/truth-social/truth_archive.json"
FED_RSS = "https://www.federalreserve.gov/feeds/press_monetary.xml"

# Identify ourselves politely (also required by Cloudflare-fronted hosts
# and by the SEC when we add EDGAR in Phase 2).
HEADERS = {
    "User-Agent": "TradeaholiksSquawk/1.0 (https://tradeaholiks.com; konadams@gmail.com)",
    "Accept": "*/*",
}

STATE_PATH = "/data/seen.json"
POLL_SECONDS = 60
MAX_ITEM_AGE_HOURS = 3      # never announce anything older than this
CLEANUP_EVERY = 60          # cycles (~1 hour)
MAX_SEEN = 2000

TAG_RE = re.compile(r"<[^>]+>")
URL_RE = re.compile(r"https?://\S+")
WS_RE = re.compile(r"\s+")


def log(*args):
    print(datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"), *args, flush=True)


def strip_html(s):
    return html.unescape(TAG_RE.sub(" ", s or "")).strip()


def normalise(text):
    """Same post from different mirrors -> same fingerprint."""
    t = URL_RE.sub("", (text or "").lower())
    t = WS_RE.sub(" ", t).strip()
    return t[:160]


def fingerprint(text):
    return hashlib.sha1(normalise(text).encode("utf-8")).hexdigest()


def load_state():
    try:
        with open(STATE_PATH) as f:
            return json.load(f)
    except Exception:
        return {"seeded": False, "hashes": []}


def save_state(state):
    state["hashes"] = state["hashes"][-MAX_SEEN:]
    os.makedirs(os.path.dirname(STATE_PATH), exist_ok=True)
    with open(STATE_PATH, "w") as f:
        json.dump(state, f)


def parse_rss(xml_text):
    """Returns list of dicts: title, description, link, pubDate (datetime or None)."""
    items = []
    root = ET.fromstring(xml_text)
    for item in root.iter("item"):
        def grab(tag):
            el = item.find(tag)
            return el.text if el is not None and el.text else ""
        pub = None
        try:
            pub = parsedate_to_datetime(grab("pubDate"))
        except Exception:
            pass
        items.append({
            "title": strip_html(grab("title")),
            "description": strip_html(grab("description")),
            "link": grab("link").strip(),
            "pub": pub,
        })
    return items


def too_old(pub):
    if pub is None:
        return False  # no timestamp -> let the seed/dedup logic handle it
    now = datetime.now(timezone.utc)
    if pub.tzinfo is None:
        pub = pub.replace(tzinfo=timezone.utc)
    return (now - pub) > timedelta(hours=MAX_ITEM_AGE_HOURS)


def fetch_trump_rss():
    r = requests.get(TRUMP_RSS, headers=HEADERS, timeout=25)
    r.raise_for_status()
    out = []
    for it in parse_rss(r.text):
        text = it["description"] or it["title"]
        if not text:
            continue
        out.append({
            "source": "truth-social",
            "who": "Donald Trump",
            "title": text[:400],
            "url": it["link"],
            "posted_at": it["pub"].isoformat() if it["pub"] else None,
            "hash": fingerprint(text),
            "pub": it["pub"],
        })
    return out


def fetch_trump_cnn():
    r = requests.get(CNN_JSON, headers=HEADERS, timeout=25)
    r.raise_for_status()
    data = r.json()
    posts = data if isinstance(data, list) else data.get("posts") or data.get("items") or []
    out = []
    for e in posts:
        if not isinstance(e, dict):
            continue
        text = strip_html(str(e.get("text") or e.get("content") or e.get("body") or ""))
        if not text:
            continue
        pub = None
        for k in ("created_at", "date", "timestamp", "time"):
            v = e.get(k)
            if v:
                try:
                    pub = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
                except Exception:
                    pass
                break
        out.append({
            "source": "truth-social",
            "who": "Donald Trump",
            "title": text[:400],
            "url": str(e.get("url") or e.get("link") or ""),
            "posted_at": pub.isoformat() if pub else None,
            "hash": fingerprint(text),
            "pub": pub,
        })
    return out


def fetch_fed():
    r = requests.get(FED_RSS, headers=HEADERS, timeout=25)
    r.raise_for_status()
    out = []
    for it in parse_rss(r.text):
        if not it["title"]:
            continue
        out.append({
            "source": "fed",
            "who": "Federal Reserve",
            "title": it["title"][:400],
            "url": it["link"],
            "posted_at": it["pub"].isoformat() if it["pub"] else None,
            "hash": fingerprint("fed|" + (it["link"] or it["title"])),
            "pub": it["pub"],
        })
    return out


def insert_alerts(rows):
    if not rows:
        return
    body = [{k: r[k] for k in ("source", "who", "title", "url", "posted_at", "hash")} for r in rows]
    r = requests.post(
        f"{SUPABASE_URL}/rest/v1/alerts?on_conflict=hash",
        headers={
            **HEADERS,
            "apikey": SERVICE_KEY,
            "Authorization": f"Bearer {SERVICE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=ignore-duplicates,return=minimal",
        },
        json=body,
        timeout=25,
    )
    if r.status_code >= 300:
        log("supabase insert failed:", r.status_code, r.text[:200])
    else:
        for row in rows:
            log("ALERT:", row["who"], "-", row["title"][:90])


def cleanup_old():
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
    r = requests.delete(
        f"{SUPABASE_URL}/rest/v1/alerts?created_at=lt.{cutoff}",
        headers={**HEADERS, "apikey": SERVICE_KEY, "Authorization": f"Bearer {SERVICE_KEY}"},
        timeout=25,
    )
    if r.status_code >= 300:
        log("cleanup failed:", r.status_code, r.text[:200])


def main():
    state = load_state()
    seen = set(state["hashes"])
    trump_fail_streak = 0
    cycle = 0
    log("squawk poller starting; seeded =", state["seeded"])

    while True:
        cycle += 1
        batches = []

        # --- Trump: trumpstruth primary, CNN failover ---
        try:
            batches.append(fetch_trump_rss())
            trump_fail_streak = 0
        except Exception as e:
            trump_fail_streak += 1
            log(f"trumpstruth fetch failed ({trump_fail_streak} in a row): {e}")
            if trump_fail_streak >= 3:
                try:
                    batches.append(fetch_trump_cnn())
                    log("using CNN failover feed")
                except Exception as e2:
                    log("CNN failover also failed:", e2)

        # --- Fed ---
        try:
            batches.append(fetch_fed())
        except Exception as e:
            log("fed fetch failed:", e)

        fresh = []
        for batch in batches:
            for row in batch:
                if row["hash"] in seen:
                    continue
                seen.add(row["hash"])
                state["hashes"].append(row["hash"])
                if state["seeded"] and not too_old(row["pub"]):
                    fresh.append(row)

        if not state["seeded"]:
            state["seeded"] = True
            log(f"first run: memorised {len(seen)} existing items, none announced")
        elif fresh:
            insert_alerts(fresh)

        if cycle % CLEANUP_EVERY == 0:
            cleanup_old()

        save_state(state)
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
