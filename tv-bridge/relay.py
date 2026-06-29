#!/usr/bin/env python3
# =============================================================================
# TAH Relay  (single-file, stdlib only -- no pip installs)
# =============================================================================
# The public middle-man for two flows that share the same "post to a queue /
# pull from the queue with a key" pattern:
#
#   1. CUSTOMER ORDERS  (TradingView -> NinjaTrader)
#        TradingView alert  --POST-->  /hook/<key>        (queues the order)
#        NinjaTrader addon  --GET--->  /pull/<key>        (gets + removes it)
#
#   2. SNAPSHOTS  (your NT Bridge on the VPS -> your Journal on the PC)
#        Bridge Snapshot Webhook --POST-->  /snap/<key>       (queues a snapshot)
#        PC snapshot puller       --GET--->  /snap-pull/<key>  (gets + removes it)
#
# Both directions are OUTBOUND from the machines involved, so neither the VPS
# nor the PC needs an inbound/open port -- they only talk out to this relay.
#
# Runs on the web VPS behind the existing Cloudflare Tunnel
# (add an ingress rule: relay.tradeaholiks.com -> http://localhost:8799).
#
# POC scope: ONE shared key. Everything is queued as files so a restart never
# loses anything. SIM trading only at the NT end for the order flow.
#
#   Run:  TVBRIDGE_KEY=pick-a-long-secret python3 relay.py
# =============================================================================
import json, os, re, time, uuid, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

KEY       = os.environ.get("TVBRIDGE_KEY", "CHANGE-ME-long-secret")
PORT      = int(os.environ.get("TVBRIDGE_PORT", "8799"))
QUEUE_DIR = os.environ.get("TVBRIDGE_QUEUE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "queue"))
SNAP_DIR  = os.path.join(QUEUE_DIR, "snaps")   # snapshots kept separate from orders
UA        = "TAH-Relay/0.2"

# Optional shared secret the Bridge sends as X-Bridge-Secret on snapshot posts.
# Leave empty to accept any caller that has the key in the URL.
SNAP_SECRET = os.environ.get("TVBRIDGE_SNAP_SECRET", "")

# Safety cap so a long-offline puller can't fill the disk. Oldest snapshots
# beyond this many are dropped (a dropped snapshot loses only the fills it
# carried; keep this generous so it effectively never trips in normal use).
SNAP_MAX = int(os.environ.get("TVBRIDGE_SNAP_MAX", "5000"))

_lock      = threading.Lock()
_snap_lock = threading.Lock()

# Bridge snapshot file names look like Bridge_Snapshot_2026-06-28_19-42-05.json
_SNAP_NAME_RE = re.compile(r"^Bridge_Snapshot_[0-9A-Za-z_\-]+\.json$")

os.makedirs(QUEUE_DIR, exist_ok=True)
os.makedirs(SNAP_DIR, exist_ok=True)

def log(msg):
    print("[%s] %s" % (time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), msg), flush=True)

class Handler(BaseHTTPRequestHandler):
    server_version = UA
    def _send(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):  # silence default noisy logging
        pass

    def do_GET(self):
        parts = [p for p in self.path.split("?")[0].split("/") if p]
        if parts == ["health"]:
            return self._send(200, {"ok": True})

        # /ping/<key> -> read-only health for a key: validates the key and
        # reports queue depths WITHOUT removing anything (safe to call often).
        if len(parts) == 2 and parts[0] == "ping":
            if parts[1] != KEY:
                return self._send(401, {"ok": False, "reason": "bad key"})
            with _snap_lock:
                snaps = len([f for f in os.listdir(SNAP_DIR) if f.endswith(".env.json")])
            with _lock:
                orders = len([f for f in os.listdir(QUEUE_DIR) if f.endswith(".json")])
            return self._send(200, {"ok": True, "snapshotsQueued": snaps, "ordersQueued": orders})

        # /pull/<key> -> oldest queued ORDER (and delete it), or 204
        if len(parts) == 2 and parts[0] == "pull":
            if parts[1] != KEY:
                return self._send(401, {"ok": False, "reason": "bad key"})
            with _lock:
                files = sorted(f for f in os.listdir(QUEUE_DIR) if f.endswith(".json"))
                if not files:
                    return self._send(204, {})
                fp = os.path.join(QUEUE_DIR, files[0])
                try:
                    with open(fp, "r", encoding="utf-8") as fh:
                        order = json.load(fh)
                    os.remove(fp)
                except Exception as e:
                    log("PULL read error: %s" % e)
                    return self._send(500, {"ok": False})
            log("PULL  -> %s" % json.dumps(order))
            return self._send(200, {"ok": True, "order": order})

        # /snap-pull/<key> -> oldest queued SNAPSHOT (and delete it), or 204
        if len(parts) == 2 and parts[0] == "snap-pull":
            if parts[1] != KEY:
                return self._send(401, {"ok": False, "reason": "bad key"})
            with _snap_lock:
                files = sorted(f for f in os.listdir(SNAP_DIR) if f.endswith(".env.json"))
                if not files:
                    return self._send(204, {})
                fp = os.path.join(SNAP_DIR, files[0])
                try:
                    with open(fp, "r", encoding="utf-8") as fh:
                        env = json.load(fh)
                    os.remove(fp)
                except Exception as e:
                    log("SNAP-PULL read error: %s" % e)
                    return self._send(500, {"ok": False})
            log("SNAP-PULL -> %s (%d bytes)" % (env.get("file", "?"), len(env.get("raw", ""))))
            # raw = the exact snapshot JSON text; file = suggested filename
            return self._send(200, {"ok": True, "file": env.get("file", ""), "raw": env.get("raw", "")})

        return self._send(404, {"ok": False, "reason": "not found"})

    def do_POST(self):
        parts = [p for p in self.path.split("?")[0].split("/") if p]

        # /hook/<key> -> queue a TradingView ORDER
        if len(parts) == 2 and parts[0] == "hook":
            if parts[1] != KEY:
                return self._send(401, {"ok": False, "reason": "bad key"})
            length = int(self.headers.get("Content-Length", "0") or "0")
            raw = self.rfile.read(length) if length else b""
            try:
                order = json.loads(raw.decode("utf-8")) if raw else {}
            except Exception:
                # TradingView can send plain text; wrap it so nothing is lost
                order = {"raw": raw.decode("utf-8", "replace")}
            order["_received_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            fname = "%d_%s.json" % (int(time.time() * 1000), uuid.uuid4().hex[:8])
            with _lock:
                with open(os.path.join(QUEUE_DIR, fname), "w", encoding="utf-8") as fh:
                    json.dump(order, fh)
            log("HOOK  <- %s" % json.dumps(order))
            return self._send(200, {"ok": True, "queued": fname})

        # /snap/<key> -> queue a full SNAPSHOT pushed by the NT Bridge
        if len(parts) == 2 and parts[0] == "snap":
            if parts[1] != KEY:
                return self._send(401, {"ok": False, "reason": "bad key"})
            if SNAP_SECRET:
                if (self.headers.get("X-Bridge-Secret") or "") != SNAP_SECRET:
                    return self._send(401, {"ok": False, "reason": "bad secret"})
            length = int(self.headers.get("Content-Length", "0") or "0")
            raw = self.rfile.read(length) if length else b""
            raw_text = raw.decode("utf-8", "replace")
            # Suggested filename from the Bridge; sanitise hard, else stamp one.
            suggested = self.headers.get("X-Bridge-Snapshot-File") or ""
            if not _SNAP_NAME_RE.match(suggested):
                suggested = "Bridge_Snapshot_" + time.strftime("%Y-%m-%d_%H-%M-%S", time.gmtime()) + ".json"
            env = {
                "file": suggested,
                "raw": raw_text,
                "_received_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            qname = "%d_%s.env.json" % (int(time.time() * 1000), uuid.uuid4().hex[:8])
            with _snap_lock:
                with open(os.path.join(SNAP_DIR, qname), "w", encoding="utf-8") as fh:
                    json.dump(env, fh)
                # enforce the safety cap (drop oldest beyond SNAP_MAX)
                allf = sorted(f for f in os.listdir(SNAP_DIR) if f.endswith(".env.json"))
                if len(allf) > SNAP_MAX:
                    for old in allf[:len(allf) - SNAP_MAX]:
                        try: os.remove(os.path.join(SNAP_DIR, old))
                        except Exception: pass
                    log("SNAP cap hit -- dropped %d oldest" % (len(allf) - SNAP_MAX))
            log("SNAP  <- %s (%d bytes)" % (suggested, len(raw_text)))
            return self._send(200, {"ok": True, "queued": qname, "file": suggested})

        return self._send(404, {"ok": False, "reason": "not found"})

if __name__ == "__main__":
    if KEY == "CHANGE-ME-long-secret":
        log("WARNING: using default key -- set TVBRIDGE_KEY to a long secret before real use")
    log("TAH relay listening on 0.0.0.0:%d  (queue: %s)" % (PORT, QUEUE_DIR))
    log("  Orders   : POST /hook/<key>   GET /pull/<key>")
    log("  Snapshots: POST /snap/<key>   GET /snap-pull/<key>")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
