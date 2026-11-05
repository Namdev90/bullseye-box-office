#!/usr/bin/env python3
"""Local-only physical pass custody demo. Python 3.10+, standard library only."""
from __future__ import annotations

import argparse
import base64
from contextlib import contextmanager
import hashlib
import hmac
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import secrets
import sqlite3
import time
from datetime import datetime, timezone
from urllib.parse import urlsplit, parse_qs

ROOT = Path(__file__).resolve().parent
CATEGORIES = ("normal", "vip", "vvip")
CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
DEFAULT_EVENT = "training-event-001"
CLAIM_SECONDS = 120
MAX_FAILED_ATTEMPTS = 5
ATTEMPT_WINDOW_SECONDS = 60


class DomainError(Exception):
    def __init__(self, message, status=400, code="INVALID_REQUEST", not_applied=True):
        super().__init__(message)
        self.status, self.code, self.not_applied = status, code, not_applied


def required_text(data, key, maximum=100):
    value = data.get(key)
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum:
        raise DomainError(f"{key.replace('_', ' ').capitalize()} must be 1–{maximum} characters.")
    value = value.strip()
    if any(ord(c) < 32 for c in value):
        raise DomainError("Control characters are not permitted.")
    return value


def quantities(value):
    if not isinstance(value, dict) or set(value) != set(CATEGORIES):
        raise DomainError("Supply Normal, VIP and VVIP quantities.")
    if any(type(value[k]) is not int or not 0 <= value[k] <= 100 for k in CATEGORIES):
        raise DomainError("Each category must be a whole number from 0 to 100.")
    if sum(value.values()) < 1:
        raise DomainError("At least one physical pass is required.")
    return {k: value[k] for k in CATEGORIES}


def encode_url(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def decode_url(data):
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


class Store:
    def __init__(self, path, clock=time.time):
        self.path = Path(path)
        self.clock = clock
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.key_path = self.path.with_suffix(self.path.suffix + ".verification.key")
        if self.path.exists() and self.path.stat().st_size and not self.key_path.exists():
            raise DomainError("The verification key is missing. Stop; do not replace it or resume from an incomplete backup.")
        if not self.key_path.exists():
            descriptor = os.open(self.key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(secrets.token_bytes(32))
        self.key = self.key_path.read_bytes()
        if len(self.key) != 32:
            raise DomainError("The verification key is invalid. Stop and reconcile recovery.")
        self.verification_session = secrets.token_hex(16)
        with self.connect() as db:
            if db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='packets'").fetchone():
                raise DomainError("The older named-collector database cannot be reused. Use a separate synthetic training database.")
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS metadata (name TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS events (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL,
                    closes_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS deposits (
                    id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id),
                    packet_id TEXT NOT NULL UNIQUE, location TEXT NOT NULL,
                    created_by TEXT NOT NULL, created_at TEXT NOT NULL,
                    version INTEGER NOT NULL DEFAULT 1,
                    initial_normal INTEGER NOT NULL, initial_vip INTEGER NOT NULL, initial_vvip INTEGER NOT NULL,
                    remaining_normal INTEGER NOT NULL CHECK(remaining_normal>=0),
                    remaining_vip INTEGER NOT NULL CHECK(remaining_vip>=0),
                    remaining_vvip INTEGER NOT NULL CHECK(remaining_vvip>=0),
                    code_hash TEXT NOT NULL UNIQUE, UNIQUE(event_id,location)
                );
                CREATE TABLE IF NOT EXISTS collections (
                    id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id),
                    deposit_id TEXT NOT NULL REFERENCES deposits(id), packet_id TEXT NOT NULL,
                    normal INTEGER NOT NULL, vip INTEGER NOT NULL, vvip INTEGER NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('RELEASE_RECORDED','HANDED_OVER')),
                    created_by TEXT NOT NULL, created_at TEXT NOT NULL,
                    handed_over_by TEXT, handed_over_at TEXT, version INTEGER NOT NULL DEFAULT 1
                );
                CREATE TABLE IF NOT EXISTS actions (
                    request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, action TEXT NOT NULL,
                    event_id TEXT NOT NULL, deposit_id TEXT NOT NULL REFERENCES deposits(id),
                    collection_id TEXT REFERENCES collections(id)
                );
                CREATE TABLE IF NOT EXISTS audit (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL,
                    deposit_id TEXT NOT NULL REFERENCES deposits(id), collection_id TEXT REFERENCES collections(id),
                    action TEXT NOT NULL, operator TEXT NOT NULL, at TEXT NOT NULL, details TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS verification_failures (at REAL NOT NULL);
            """)
            key_fingerprint = hashlib.sha256(b"pass-desk-key-v1\0" + self.key).hexdigest()
            prior_key = db.execute("SELECT value FROM metadata WHERE name='verification_key_fingerprint'").fetchone()
            if prior_key and not hmac.compare_digest(prior_key["value"], key_fingerprint):
                raise DomainError("The verification key does not match this database. Stop and use the matching backup pair.")
            db.execute("INSERT OR IGNORE INTO metadata VALUES('verification_key_fingerprint',?)", (key_fingerprint,))
            for event_id, name in ((DEFAULT_EVENT, "Demo Night · Training"), ("training-event-002", "Demo Festival · Training")):
                db.execute("INSERT OR IGNORE INTO events VALUES(?,?,1,?)", (event_id, name, self.clock() + 7 * 86400))

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

    def timestamp(self):
        return datetime.fromtimestamp(self.clock(), timezone.utc).isoformat(timespec="milliseconds")

    def event(self, event_id, db, require_open=False):
        row = db.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
        if not row:
            raise DomainError("Training event not found.", 404, "EVENT_NOT_FOUND")
        if require_open and (not row["active"] or row["closes_at"] <= self.clock()):
            raise DomainError("This event is closed. Stop and contact the supervisor.", 409, "EVENT_CLOSED")
        return dict(row)

    def collection_code(self, deposit_id, event_id):
        digest = hmac.new(self.key, ("code\0" + event_id + "\0" + deposit_id).encode(), hashlib.sha256).digest()
        number = int.from_bytes(digest[:8], "big") >> 4
        raw = "".join(CODE_ALPHABET[(number >> (5 * i)) & 31] for i in reversed(range(12)))
        return "-".join(raw[i:i + 4] for i in range(0, 12, 4))

    def code_digest(self, code, event_id):
        normalized = "".join(c for c in code.upper() if c not in " -")
        return hmac.new(self.key, ("lookup\0" + event_id + "\0" + normalized).encode(), hashlib.sha256).hexdigest()

    def get_collection(self, collection_id, event_id, db):
        row = db.execute("SELECT * FROM collections WHERE id=? AND event_id=?", (collection_id, event_id)).fetchone()
        if not row:
            raise DomainError("Collection not found in this event.", 404, "COLLECTION_NOT_FOUND")
        data = dict(row)
        data["quantities"] = {key: data.pop(key) for key in CATEGORIES}
        return data

    def get_deposit(self, deposit_id, event_id, db):
        row = db.execute("SELECT * FROM deposits WHERE id=? AND event_id=?", (deposit_id, event_id)).fetchone()
        if not row:
            raise DomainError("Deposit not found in this event.", 404, "DEPOSIT_NOT_FOUND")
        data = dict(row)
        data.pop("code_hash")
        data["initial"] = {key: data.pop("initial_" + key) for key in CATEGORIES}
        data["remaining"] = {key: data.pop("remaining_" + key) for key in CATEGORIES}
        pending = db.execute("SELECT id FROM collections WHERE deposit_id=? AND status='RELEASE_RECORDED'", (deposit_id,)).fetchone()
        data["pending_collection"] = self.get_collection(pending["id"], event_id, db) if pending else None
        return data

    def state(self, event_id=DEFAULT_EVENT):
        with self.connect() as db:
            db.execute("BEGIN")  # One consistent read snapshot for balances, collections and audit.
            event = self.event(event_id, db)
            deposits = [self.get_deposit(row["id"], event_id, db) for row in db.execute("SELECT id FROM deposits WHERE event_id=? ORDER BY created_at DESC,id", (event_id,)).fetchall()]
            collections = [self.get_collection(row["id"], event_id, db) for row in db.execute("SELECT id FROM collections WHERE event_id=? ORDER BY created_at DESC,id", (event_id,)).fetchall()]
            audit = []
            for row in db.execute("SELECT * FROM audit WHERE event_id=? ORDER BY seq DESC LIMIT 100", (event_id,)):
                entry = dict(row); entry["details"] = json.loads(entry["details"]); audit.append(entry)
            return {"event_id":event_id, "event_name":event["name"], "events":[dict(row) for row in db.execute("SELECT * FROM events ORDER BY id")], "deposits":deposits, "collections":collections, "audit":audit, "counts":{"DEPOSITS":len(deposits), "PASSES_REMAINING":sum(sum(d["remaining"].values()) for d in deposits), "UNCONFIRMED":sum(c["status"]=="RELEASE_RECORDED" for c in collections), "HANDED_OVER":sum(sum(c["quantities"].values()) for c in collections if c["status"]=="HANDED_OVER")}}

    def verify(self, data):
        if not isinstance(data, dict):
            raise DomainError("Expected a JSON object.")
        event_id = required_text(data, "event_id", 60)
        code = data.get("collection_code")
        # The failed-attempt budget is global for the one local desk, not per code.
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                db.execute("DELETE FROM verification_failures WHERE at<=?", (self.clock() - ATTEMPT_WINDOW_SECONDS,))
                attempts = db.execute("SELECT COUNT(*) FROM verification_failures WHERE at>?", (self.clock() - ATTEMPT_WINDOW_SECONDS,)).fetchone()[0]
                if attempts >= MAX_FAILED_ATTEMPTS:
                    raise DomainError("Too many unsuccessful code checks. Wait one minute before trying again.", 429, "RATE_LIMITED")
                event = db.execute("SELECT * FROM events WHERE id=?", (event_id,)).fetchone()
                valid_format = isinstance(code, str) and len(code) <= 40
                normalized = "".join(c for c in code.upper() if c not in " -") if valid_format else ""
                valid_format = valid_format and len(normalized) == 12 and all(c in CODE_ALPHABET for c in normalized)
                row = db.execute("SELECT id FROM deposits WHERE event_id=? AND code_hash=?", (event_id, self.code_digest(normalized, event_id))).fetchone() if valid_format else None
                if not row or not event or not event["active"] or event["closes_at"] <= self.clock():
                    db.execute("INSERT INTO verification_failures VALUES(?)", (self.clock(),)); db.commit()
                    raise DomainError("Code not accepted for this event. Check the code and selected event.", 404, "CODE_NOT_ACCEPTED")
                deposit = self.get_deposit(row["id"], event_id, db)
                payload = {"deposit_id":deposit["id"], "event_id":event_id, "expires":self.clock()+CLAIM_SECONDS, "session":self.verification_session, "nonce":secrets.token_hex(8)}
                encoded = encode_url(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode())
                signature = encode_url(hmac.new(self.key, ("claim\0" + encoded).encode(), hashlib.sha256).digest())
                db.commit()
                return {"deposit":deposit, "claim_token":encoded+"."+signature, "expires_in":CLAIM_SECONDS}
            except Exception:
                if db.in_transaction: db.rollback()
                raise

    def check_claim(self, token, deposit_id, event_id):
        try:
            if not isinstance(token, str) or len(token)>1000: raise ValueError()
            encoded, signature = token.split(".")
            expected = encode_url(hmac.new(self.key, ("claim\0" + encoded).encode(), hashlib.sha256).digest())
            if not hmac.compare_digest(signature, expected): raise ValueError()
            payload = json.loads(decode_url(encoded))
            if payload["deposit_id"] != deposit_id or payload["event_id"] != event_id or payload["session"] != self.verification_session or payload["expires"] <= self.clock(): raise ValueError()
        except (ValueError, TypeError, KeyError, UnicodeError):
            raise DomainError("Code verification expired or is invalid. Nothing was released by this request; verify the code again.", 401, "CLAIM_EXPIRED")

    def result(self, db, action, deposit_id, event_id, collection_id, replayed):
        response = {"deposit":self.get_deposit(deposit_id, event_id, db), "collection":self.get_collection(collection_id,event_id,db) if collection_id else None, "replayed":replayed}
        if action == "DEPOSIT": response["collection_code"] = self.collection_code(deposit_id,event_id)
        return response

    def mutate(self, action, data, target_id=None):
        if not isinstance(data, dict): raise DomainError("Expected a JSON object.")
        request_id = required_text(data,"request_id",100)
        operator = required_text(data,"operator",80)
        event_id = required_text(data,"event_id",60)
        fingerprint = hashlib.sha256(json.dumps({"action":action,"target_id":target_id,"data":data},sort_keys=True,separators=(",",":")).encode()).hexdigest()
        with self.connect() as db:
            try:
                db.execute("BEGIN IMMEDIATE")
                prior = db.execute("SELECT * FROM actions WHERE request_id=?",(request_id,)).fetchone()
                if prior:
                    if not hmac.compare_digest(prior["fingerprint"],fingerprint):
                        raise DomainError("Request ID conflicts with an earlier action. Reconcile its outcome before proceeding.",409,"REQUEST_CONFLICT",False)
                    result=self.result(db,action,prior["deposit_id"],event_id,prior["collection_id"],True)
                    db.commit(); return result
                # Handover reconciliation is permitted after an event closes; new releases are not.
                self.event(event_id,db,require_open=action!="HANDOVER")
                timestamp=self.timestamp(); collection_id=None
                if action == "DEPOSIT":
                    counts=quantities(data.get("quantities"))
                    location=required_text(data,"location",30).upper()
                    if data.get("custody_confirmed") is not True:
                        raise DomainError("Confirm the counted physical passes are in the recorded event shelf slot.")
                    deposit_id=secrets.token_hex(16)
                    packet_id="BX-"+"".join(secrets.choice(CODE_ALPHABET) for _ in range(8))
                    code_hash=self.code_digest(self.collection_code(deposit_id,event_id),event_id)
                    try:
                        db.execute("INSERT INTO deposits(id,event_id,packet_id,location,created_by,created_at,initial_normal,initial_vip,initial_vvip,remaining_normal,remaining_vip,remaining_vvip,code_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",(deposit_id,event_id,packet_id,location,operator,timestamp,*counts.values(),*counts.values(),code_hash))
                    except sqlite3.IntegrityError as error:
                        raise DomainError("This event shelf slot is already assigned. Use a fresh slot.",409,"SLOT_OCCUPIED") from error
                    details={"packet_id":packet_id,"location":location,"categories":counts,"code_generated":True}
                    audit_action="CODE_GENERATED"
                elif action == "RELEASE":
                    deposit_id=target_id
                    deposit=self.get_deposit(deposit_id,event_id,db)
                    self.check_claim(data.get("claim_token"),deposit_id,event_id)
                    if type(data.get("version")) is not int or data["version"] != deposit["version"]:
                        raise DomainError("Balances changed. Nothing was released by this request; verify the code and quantities again.",409,"STALE_BALANCE")
                    if deposit["pending_collection"]:
                        raise DomainError("A previous handover is unconfirmed. Resolve its physical custody before releasing more.",409,"HANDOVER_PENDING")
                    packet_id=data.get("packet_id")
                    if not isinstance(packet_id,str) or packet_id.strip().upper()!=deposit["packet_id"]:
                        raise DomainError("Physical packet label does not match. Retrieve the correct packet.",400,"WRONG_PACKET")
                    counts=quantities(data.get("quantities"))
                    if any(counts[k]>deposit["remaining"][k] for k in CATEGORIES):
                        raise DomainError("Requested quantities exceed the remaining passes. Nothing was released.",409,"OVER_RELEASE")
                    remaining={k:deposit["remaining"][k]-counts[k] for k in CATEGORIES}
                    collection_id=secrets.token_hex(16)
                    db.execute("UPDATE deposits SET remaining_normal=?,remaining_vip=?,remaining_vvip=?,version=version+1 WHERE id=?",(*remaining.values(),deposit_id))
                    db.execute("INSERT INTO collections(id,event_id,deposit_id,packet_id,normal,vip,vvip,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,'RELEASE_RECORDED',?,?)",(collection_id,event_id,deposit_id,deposit["packet_id"],*counts.values(),operator,timestamp))
                    details={"packet_id":deposit["packet_id"],"released":counts,"remaining":remaining}
                    audit_action="RELEASE_RECORDED"
                elif action == "HANDOVER":
                    collection=self.get_collection(target_id,event_id,db)
                    deposit_id=collection["deposit_id"]; collection_id=target_id
                    if type(data.get("version")) is not int or data["version"]!=collection["version"] or collection["status"]!="RELEASE_RECORDED":
                        raise DomainError("Handover status changed or is already confirmed. Do not issue passes again.",409,"STALE_HANDOVER")
                    if data.get("handover_confirmed") is not True:
                        raise DomainError("Confirm these exact passes were handed over once.")
                    if operator!=collection["created_by"]:
                        raise DomainError("Only the original operator label may confirm this handover in the demo. Escalate uncertain custody.",409,"OPERATOR_MISMATCH")
                    db.execute("UPDATE collections SET status='HANDED_OVER',version=version+1,handed_over_by=?,handed_over_at=? WHERE id=?",(operator,timestamp,collection_id))
                    # Deposit versions also track pending-handover changes, not just quantity changes.
                    db.execute("UPDATE deposits SET version=version+1 WHERE id=?",(deposit_id,))
                    details={"packet_id":collection["packet_id"],"handed_over":collection["quantities"]}
                    audit_action="HANDED_OVER"
                else:
                    raise DomainError("Unknown action.")
                db.execute("INSERT INTO actions VALUES(?,?,?,?,?,?)",(request_id,fingerprint,action,event_id,deposit_id,collection_id))
                db.execute("INSERT INTO audit(event_id,deposit_id,collection_id,action,operator,at,details) VALUES(?,?,?,?,?,?,?)",(event_id,deposit_id,collection_id,audit_action,operator,timestamp,json.dumps(details,sort_keys=True)))
                result=self.result(db,action,deposit_id,event_id,collection_id,False)
                db.commit(); return result
            except Exception:
                if db.in_transaction: db.rollback()
                raise

    def seed(self):
        for index,(counts,location,event_id) in enumerate((({"normal":6,"vip":2,"vvip":1},"A-01",DEFAULT_EVENT),({"normal":3,"vip":0,"vvip":0},"A-02",DEFAULT_EVENT),({"normal":4,"vip":1,"vvip":0},"B-01","training-event-002"))):
            self.mutate("DEPOSIT",{"request_id":f"seed-code-demo-{index}","operator":"Demo setup","event_id":event_id,"location":location,"quantities":counts,"custody_confirmed":True})

    def backup(self,destination):
        destination=Path(destination); key_destination=destination.with_suffix(destination.suffix+".verification.key")
        if destination.exists() or key_destination.exists(): raise DomainError("Backup target already exists; refusing to overwrite.")
        destination.parent.mkdir(parents=True,exist_ok=True)
        from contextlib import closing
        with self.connect() as source,closing(sqlite3.connect(destination)) as target:
            source.backup(target)
            if target.execute("PRAGMA integrity_check").fetchone()[0]!="ok": raise DomainError("Backup integrity check failed.")
        descriptor=os.open(key_destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(descriptor,"wb") as handle: handle.write(self.key)
        return destination,key_destination


class Server(ThreadingHTTPServer):
    daemon_threads=True
    def __init__(self,address,store):
        super().__init__(address,Handler)
        self.store=store; self.session=secrets.token_urlsafe(32); self.csrf=secrets.token_urlsafe(32)


class Handler(BaseHTTPRequestHandler):
    server_version="CustodyDemo/2.0"
    def log_message(self,fmt,*args): pass  # No URLs, codes, tokens, phones or guest data in request logs.
    def valid_host(self):
        port=self.server.server_address[1]
        return self.headers.get("Host") in (f"127.0.0.1:{port}",f"localhost:{port}")
    def authorized(self):
        cookie=SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie",""))
            value=cookie["custody_session"].value if "custody_session" in cookie else ""
            return hmac.compare_digest(value,self.server.session)
        except Exception: return False
    def send(self,status,body,content_type="application/json; charset=utf-8",set_cookie=False):
        if not isinstance(body,bytes): body=json.dumps(body,ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type",content_type); self.send_header("Content-Length",str(len(body)))
        self.send_header("Cache-Control","no-store"); self.send_header("X-Content-Type-Options","nosniff")
        self.send_header("Referrer-Policy","no-referrer")
        self.send_header("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'")
        if set_cookie: self.send_header("Set-Cookie",f"custody_session={self.server.session}; HttpOnly; SameSite=Strict; Path=/")
        self.end_headers(); self.wfile.write(body)
    def error(self,status,message,code="REQUEST_REJECTED",not_applied=False):
        self.send(status,{"error":message,"code":code,"not_applied":not_applied})
    def do_GET(self):
        if not self.valid_host(): return self.error(403,"Invalid host. Use the printed local address.")
        path=urlsplit(self.path).path
        if path=="/api/state":
            if not self.authorized(): return self.error(401,"Open the app home page to establish a local session.")
            try:
                event_id=parse_qs(urlsplit(self.path).query).get("event_id",[DEFAULT_EVENT])[0]
                result=self.server.store.state(event_id); result["csrf"]=self.server.csrf
                return self.send(200,result)
            except DomainError as error: return self.error(error.status,str(error),error.code,error.not_applied)
        files={"/":"index.html","/app.js":"app.js","/style.css":"style.css","/desk-enhancements.js":"desk-enhancements.js","/assets/bullseye-entertainment.jpg":"assets/bullseye-entertainment.jpg"}
        if path not in files: return self.error(404,"Not found.")
        filename=ROOT/"static"/files[path]
        content_type=mimetypes.guess_type(str(filename))[0] or "application/octet-stream"
        self.send(200,filename.read_bytes(),content_type+"; charset=utf-8",path=="/")
    def do_POST(self):
        if not self.valid_host() or not self.authorized(): return self.error(403,"Local session required. Reload and inspect any pending request.")
        origin=self.headers.get("Origin")
        if origin and origin!=f"http://{self.headers.get('Host')}": return self.error(403,"Cross-origin writes are not allowed.")
        if not hmac.compare_digest(self.headers.get("X-CSRF-Token",""),self.server.csrf): return self.error(403,"Session changed. Reload before recovering the original request.")
        if self.headers.get("Content-Type","").split(";")[0]!="application/json": return self.error(415,"JSON content type required.")
        try:
            length=int(self.headers.get("Content-Length","0"))
            if not 0<length<=16384: raise DomainError("Invalid request size.")
            data=json.loads(self.rfile.read(length)); path=urlsplit(self.path).path
            if path=="/api/verify": result=self.server.store.verify(data)
            elif path=="/api/deposits": result=self.server.store.mutate("DEPOSIT",data)
            else:
                parts=path.strip("/").split("/")
                if len(parts)!=4 or parts[0]!="api": raise DomainError("Not found.",404)
                if parts[1]=="deposits" and parts[3]=="release": result=self.server.store.mutate("RELEASE",data,parts[2])
                elif parts[1]=="collections" and parts[3]=="handover": result=self.server.store.mutate("HANDOVER",data,parts[2])
                else: raise DomainError("Not found.",404)
            self.send(200,result)
        except (ValueError,json.JSONDecodeError): self.error(400,"Invalid JSON request.",not_applied=True)
        except DomainError as error: self.error(error.status,str(error),error.code,error.not_applied)
        except Exception: self.error(500,"Outcome uncertain. Do not repeat a physical handover; recover the saved request and reconcile custody.","UNCERTAIN_OUTCOME",False)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port",type=int,default=8765)
    parser.add_argument("--db",type=Path,default=ROOT/"_runtime"/"shared-code-training.sqlite3")
    parser.add_argument("--demo",action="store_true",help="Add synthetic example deposits without logging their collection codes.")
    parser.add_argument("--backup",type=Path,help="Save an integrity-checked database and matching secret verification key; then exit.")
    args=parser.parse_args(); store=Store(args.db)
    if args.backup:
        store.backup(args.backup)
        print("Backup saved with its secret verification-key companion. Protect both; reconcile every later handover before any restore.")
        return
    if args.demo: store.seed()
    server=Server(("127.0.0.1",args.port),store)
    print(f"Training demo: http://127.0.0.1:{server.server_address[1]}",flush=True)
    print("One trusted laptop. Synthetic physical passes only. Codes and phones are never printed to request logs.",flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()


if __name__=="__main__": main()
