#!/usr/bin/env python3
"""Local-only pass custody prototype. Python 3.10+, standard library only."""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import mimetypes
import secrets
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

ROOT = Path(__file__).resolve().parent
EVENT_ID = "training-event-001"
EVENT_NAME = "Demo Night · Training event"


class DomainError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def required_text(data, key, maximum=100):
    value = data.get(key)
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum:
        raise DomainError(f"{key.replace('_', ' ').capitalize()} must be 1–{maximum} characters.")
    value = value.strip()
    if any(ord(c) < 32 for c in value):
        raise DomainError("Control characters are not permitted.")
    return value


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS packets (
                    id TEXT PRIMARY KEY, event_id TEXT NOT NULL, code TEXT NOT NULL UNIQUE,
                    depositor TEXT NOT NULL, collector TEXT NOT NULL, category TEXT NOT NULL,
                    quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 20),
                    location TEXT NOT NULL UNIQUE, status TEXT NOT NULL
                        CHECK(status IN ('READY','RELEASE_RECORDED','HANDED_OVER')),
                    version INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL, created_by TEXT NOT NULL,
                    released_at TEXT, released_by TEXT, handed_over_at TEXT, handed_over_by TEXT
                );
                CREATE TABLE IF NOT EXISTS actions (
                    request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL,
                    packet_id TEXT NOT NULL REFERENCES packets(id), action TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS audit (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL,
                    packet_id TEXT NOT NULL REFERENCES packets(id), action TEXT NOT NULL,
                    operator TEXT NOT NULL, at TEXT NOT NULL, details TEXT NOT NULL
                );
            """)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA synchronous=FULL")
        try:
            yield db
        finally:
            db.close()

    def get(self, packet_id, db=None):
        if db is None:
            with self.connect() as connection:
                return self.get(packet_id, connection)
        row = db.execute("SELECT * FROM packets WHERE id=? AND event_id=?", (packet_id, EVENT_ID)).fetchone()
        if not row:
            raise DomainError("Packet not found in this event.", 404)
        return dict(row)

    def state(self, query=""):
        with self.connect() as db:
            rows = db.execute("SELECT * FROM packets WHERE event_id=? ORDER BY created_at DESC, code", (EVENT_ID,)).fetchall()
            packets = [dict(row) for row in rows]
            counts = {s: sum(p["status"] == s for p in packets) for s in ("READY", "RELEASE_RECORDED", "HANDED_OVER")}
            counts["PASSES_IN_CUSTODY"] = sum(p["quantity"] for p in packets if p["status"] == "READY")
            if query:
                q = query.casefold()
                packets = [p for p in packets if any(q in str(p[k]).casefold() for k in ("collector", "depositor", "code", "location"))]
            audit = [dict(row) for row in db.execute("SELECT * FROM audit WHERE event_id=? ORDER BY seq DESC LIMIT 40", (EVENT_ID,))]
            return {"event_id": EVENT_ID, "event_name": EVENT_NAME, "packets": packets, "counts": counts, "audit": audit}

    def mutate(self, action, data, packet_id=None):
        if not isinstance(data, dict):
            raise DomainError("Expected a JSON object.")
        request_id = required_text(data, "request_id", 100)
        operator = required_text(data, "operator", 80)
        fingerprint = hashlib.sha256(json.dumps({"action": action, "packet_id": packet_id, "data": data}, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        with self.connect() as db:
            try:
                db.execute("BEGIN IMMEDIATE")
                prior = db.execute("SELECT * FROM actions WHERE request_id=?", (request_id,)).fetchone()
                if prior:
                    if not hmac.compare_digest(prior["fingerprint"], fingerprint):
                        raise DomainError("This request ID was already used for different information. Refresh and check the packet.", 409)
                    packet = self.get(prior["packet_id"], db)
                    db.commit()
                    return {"packet": packet, "replayed": True}
                timestamp = now()
                if action == "DEPOSIT":
                    depositor = required_text(data, "depositor")
                    collector = required_text(data, "collector")
                    category = required_text(data, "category", 60)
                    location = required_text(data, "location", 30).upper()
                    quantity = data.get("quantity")
                    if type(quantity) is not int or not 1 <= quantity <= 20:
                        raise DomainError("Quantity must be a whole number from 1 to 20.")
                    if data.get("custody_confirmed") is not True:
                        raise DomainError("Confirm the counted, sealed packet is in its recorded shelf slot.")
                    packet_id = secrets.token_hex(16)
                    alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
                    code = "BX-" + "".join(secrets.choice(alphabet) for _ in range(8))
                    try:
                        db.execute("INSERT INTO packets(id,event_id,code,depositor,collector,category,quantity,location,status,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                                   (packet_id, EVENT_ID, code, depositor, collector, category, quantity, location, "READY", timestamp, operator))
                    except sqlite3.IntegrityError as error:
                        raise DomainError("That shelf slot has already been assigned. Use a new slot; prototype slots are not reused during an event.", 409) from error
                    details = {"quantity": quantity, "location": location, "custody_confirmed": True}
                else:
                    packet = self.get(packet_id, db)
                    if type(data.get("version")) is not int or data["version"] != packet["version"]:
                        raise DomainError("This packet changed in another window. Refresh and inspect its current status before proceeding.", 409)
                    if action == "RELEASE":
                        if packet["status"] != "READY":
                            raise DomainError("Release has already been recorded. Do not issue this packet again.", 409)
                        if data.get("identity_verified") is not True:
                            raise DomainError("Visually check accepted photo ID and match it to the named collector. Do not record ID details.")
                        if not isinstance(data.get("packet_code"), str) or data["packet_code"].strip().upper() != packet["code"]:
                            raise DomainError("Packet label does not match. Stop and retrieve the correct packet.")
                        db.execute("UPDATE packets SET status='RELEASE_RECORDED',version=version+1,released_at=?,released_by=? WHERE id=?", (timestamp, operator, packet_id))
                        details = {"identity_check": "visual_photo_id", "packet_label_matched": True}
                    elif action == "HANDOVER":
                        if packet["status"] != "RELEASE_RECORDED":
                            raise DomainError("Handover can only be confirmed for a recorded release.", 409)
                        if data.get("handover_confirmed") is not True:
                            raise DomainError("Confirm the physical handover has happened exactly once.")
                        if operator != packet["released_by"]:
                            raise DomainError("Only the operator who recorded this release may confirm handover in the prototype. Escalate uncertain custody to your supervisor.", 409)
                        db.execute("UPDATE packets SET status='HANDED_OVER',version=version+1,handed_over_at=?,handed_over_by=? WHERE id=?", (timestamp, operator, packet_id))
                        details = {"physical_handover_confirmed": True}
                    else:
                        raise DomainError("Unknown action.")
                db.execute("INSERT INTO actions VALUES(?,?,?,?)", (request_id, fingerprint, packet_id, action))
                db.execute("INSERT INTO audit(event_id,packet_id,action,operator,at,details) VALUES(?,?,?,?,?,?)", (EVENT_ID, packet_id, action, operator, timestamp, json.dumps(details)))
                result = {"packet": self.get(packet_id, db), "replayed": False}
                db.commit()
                return result
            except Exception:
                db.rollback()
                raise

    def seed(self):
        examples = [("Taylor Demo", "Alex Demo", "General admission", 2, "A-01"), ("Morgan Sample", "Casey Sample", "VIP", 1, "A-02"), ("Jordan Example", "Robin Example", "General admission", 3, "A-03")]
        for index, (depositor, collector, category, quantity, location) in enumerate(examples):
            self.mutate("DEPOSIT", {"request_id": f"demo-seed-{index}", "operator": "Demo setup", "depositor": depositor, "collector": collector, "category": category, "quantity": quantity, "location": location, "custody_confirmed": True})

    def backup(self, destination):
        destination = Path(destination)
        if destination.exists():
            raise DomainError("Backup destination already exists; refusing to overwrite it.")
        destination.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as source, sqlite3.connect(destination) as target:
            source.backup(target)
            if target.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise DomainError("Backup integrity check failed.")
        return destination


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, store):
        super().__init__(address, Handler)
        self.store = store
        self.session = secrets.token_urlsafe(32)
        self.csrf = secrets.token_urlsafe(32)


class Handler(BaseHTTPRequestHandler):
    server_version = "CustodyPrototype/1.0"

    def log_message(self, fmt, *args):
        # Deliberately avoid request URLs, query strings and guest details in logs.
        pass

    def valid_host(self):
        port = self.server.server_address[1]
        return self.headers.get("Host") in (f"127.0.0.1:{port}", f"localhost:{port}")

    def authorized(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
            value = cookie["custody_session"].value if "custody_session" in cookie else ""
            return hmac.compare_digest(value, self.server.session)
        except Exception:
            return False

    def send(self, status, body, content_type="application/json; charset=utf-8", set_cookie=False):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'")
        if set_cookie:
            self.send_header("Set-Cookie", f"custody_session={self.server.session}; HttpOnly; SameSite=Strict; Path=/")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self.valid_host():
            return self.send(403, {"error": "Invalid host. Open the printed loopback address."})
        path = urlsplit(self.path).path
        if path.startswith("/api/"):
            if not self.authorized():
                return self.send(401, {"error": "Open the app home page to establish a local session."})
            if path == "/api/state":
                query = parse_qs(urlsplit(self.path).query).get("q", [""])[0][:200]
                result = self.server.store.state(query)
                result["csrf"] = self.server.csrf
                return self.send(200, result)
            if path.startswith("/api/packets/"):
                try:
                    return self.send(200, {"packet": self.server.store.get(path.split("/")[-1])})
                except DomainError as error:
                    return self.send(error.status, {"error": str(error)})
            return self.send(404, {"error": "Not found."})
        files = {"/": "index.html", "/app.js": "app.js", "/style.css": "style.css"}
        if path not in files:
            return self.send(404, {"error": "Not found."})
        filename = ROOT / "static" / files[path]
        content_type = mimetypes.guess_type(str(filename))[0] or "application/octet-stream"
        self.send(200, filename.read_bytes(), content_type + "; charset=utf-8", set_cookie=path == "/")

    def do_POST(self):
        if not self.valid_host() or not self.authorized():
            return self.send(403, {"error": "Local session required. Reload the home page."})
        origin = self.headers.get("Origin")
        if origin and origin != f"http://{self.headers.get('Host')}":
            return self.send(403, {"error": "Cross-origin writes are not allowed."})
        if not hmac.compare_digest(self.headers.get("X-CSRF-Token", ""), self.server.csrf):
            return self.send(403, {"error": "Session changed. Reload, then check the packet before retrying."})
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            return self.send(415, {"error": "JSON content type required."})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 16384:
                raise DomainError("Invalid request size.")
            data = json.loads(self.rfile.read(length))
            path = urlsplit(self.path).path
            if path == "/api/deposits":
                result = self.server.store.mutate("DEPOSIT", data)
            else:
                parts = path.strip("/").split("/")
                if len(parts) != 4 or parts[:2] != ["api", "packets"] or parts[3] not in ("release", "handover"):
                    raise DomainError("Not found.", 404)
                result = self.server.store.mutate("RELEASE" if parts[3] == "release" else "HANDOVER", data, parts[2])
            self.send(200, result)
        except (json.JSONDecodeError, ValueError):
            self.send(400, {"error": "Invalid JSON request."})
        except DomainError as error:
            self.send(error.status, {"error": str(error)})
        except Exception:
            self.send(500, {"error": "Action outcome is uncertain. Do not repeat a physical handover. Reconnect and inspect the packet."})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--db", type=Path, default=ROOT / "_runtime" / "training.sqlite3")
    parser.add_argument("--demo", action="store_true", help="Add three synthetic demo packets (safe to repeat).")
    parser.add_argument("--backup", type=Path, help="Create an integrity-checked snapshot and exit. Do not restore while operating.")
    args = parser.parse_args()
    store = Store(args.db)
    if args.backup:
        print(f"Backup saved to {store.backup(args.backup)}. Protect it as sensitive data. Reconcile custody before any restore.")
        return
    if args.demo:
        store.seed()
    server = Server(("127.0.0.1", args.port), store)
    print(f"Training prototype: http://127.0.0.1:{server.server_address[1]}", flush=True)
    print("Single laptop only. Synthetic data only. Ctrl+C stops the server; saved records persist.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
