import concurrent.futures
import http.client
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest

from app import Store, Server, DomainError


def deposit(**overrides):
    data = dict(request_id="deposit-1", operator="Demo Operator", depositor="Taylor Demo", collector="Alex Demo", category="General admission", quantity=2, location="A-01", custody_confirmed=True)
    data.update(overrides)
    return data


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "db.sqlite3"
        self.store = Store(self.path)

    def tearDown(self):
        self.temp.cleanup()

    def make(self):
        return self.store.mutate("DEPOSIT", deposit())["packet"]

    def release(self, packet, request_id="release-1", **overrides):
        data = dict(request_id=request_id, operator="Demo Operator", version=packet["version"], packet_code=packet["code"], identity_verified=True)
        data.update(overrides)
        return self.store.mutate("RELEASE", data, packet["id"])

    def handover(self, packet, request_id="handover-1", **overrides):
        data = dict(request_id=request_id, operator="Demo Operator", version=packet["version"], handover_confirmed=True)
        data.update(overrides)
        return self.store.mutate("HANDOVER", data, packet["id"])

    def test_deposit_preserves_packet_and_audit(self):
        packet = self.make()
        self.assertEqual(packet["status"], "READY")
        self.assertEqual(packet["quantity"], 2)
        self.assertTrue(packet["code"].startswith("BX-"))
        self.assertEqual(len(self.store.state()["audit"]), 1)

    def test_complete_flow(self):
        packet = self.make()
        released = self.release(packet)["packet"]
        self.assertEqual(released["status"], "RELEASE_RECORDED")
        self.assertEqual(released["version"], 2)
        done = self.handover(released)["packet"]
        self.assertEqual(done["status"], "HANDED_OVER")
        self.assertEqual(done["version"], 3)
        self.assertEqual([a["action"] for a in self.store.state()["audit"]], ["HANDOVER", "RELEASE", "DEPOSIT"])

    def test_duplicate_deposit_same_key(self):
        first = self.make()
        repeated = self.store.mutate("DEPOSIT", deposit())
        self.assertTrue(repeated["replayed"])
        self.assertEqual(first["id"], repeated["packet"]["id"])
        self.assertEqual(len(self.store.state()["packets"]), 1)

    def test_same_key_different_payload_rejected(self):
        self.make()
        changed = deposit(); changed["quantity"] = 3
        with self.assertRaises(DomainError) as cm:
            self.store.mutate("DEPOSIT", changed)
        self.assertEqual(cm.exception.status, 409)

    def test_replayed_release_returns_current_completed_state(self):
        packet = self.make()
        released = self.release(packet)["packet"]
        self.handover(released)
        repeat = self.release(packet)
        self.assertTrue(repeat["replayed"])
        self.assertEqual(repeat["packet"]["status"], "HANDED_OVER")
        self.assertEqual(len(self.store.state()["audit"]), 3)

    def test_duplicate_release_different_key_fails(self):
        packet = self.make(); self.release(packet)
        with self.assertRaises(DomainError):
            self.release(packet, "release-2")
        self.assertEqual(len(self.store.state()["audit"]), 2)

    def test_parallel_distinct_releases_exactly_one_wins(self):
        packet = self.make()
        def worker(index):
            try:
                self.release(packet, f"parallel-{index}"); return True
            except DomainError:
                return False
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            outcomes = list(pool.map(worker, range(16)))
        self.assertEqual(sum(outcomes), 1)
        self.assertEqual(self.store.get(packet["id"])["status"], "RELEASE_RECORDED")
        self.assertEqual(len(self.store.state()["audit"]), 2)

    def test_parallel_identical_retry_creates_one_action(self):
        packet = self.make()
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: self.release(packet), range(12)))
        self.assertEqual(sum(not result["replayed"] for result in results), 1)
        self.assertEqual(len(self.store.state()["audit"]), 2)

    def test_wrong_label_rejected_without_audit(self):
        packet = self.make()
        with self.assertRaises(DomainError): self.release(packet, packet_code="BX-WRONG")
        self.assertEqual(self.store.get(packet["id"])["status"], "READY")
        self.assertEqual(len(self.store.state()["audit"]), 1)

    def test_identity_confirmation_must_be_boolean(self):
        packet = self.make()
        for value in (False, "true", 1, None):
            with self.assertRaises(DomainError): self.release(packet, identity_verified=value)

    def test_no_handover_before_release(self):
        with self.assertRaises(DomainError): self.handover(self.make())

    def test_only_original_operator_confirms_handover(self):
        packet = self.release(self.make())["packet"]
        with self.assertRaises(DomainError): self.handover(packet, operator="Another Operator")
        self.assertEqual(self.store.get(packet["id"])["status"], "RELEASE_RECORDED")

    def test_confirmed_handover_cannot_repeat_with_new_key(self):
        packet = self.release(self.make())["packet"]
        done = self.handover(packet)["packet"]
        with self.assertRaises(DomainError): self.handover(done, "another-handover")

    def test_restart_preserves_deduplication_and_state(self):
        packet = self.make(); self.release(packet)
        self.store = Store(self.path)
        retry = self.release(packet)
        self.assertTrue(retry["replayed"])
        self.assertEqual(retry["packet"]["status"], "RELEASE_RECORDED")

    def test_missing_packet_is_not_found(self):
        with self.assertRaises(DomainError) as cm: self.store.get("wrong-event-code")
        self.assertEqual(cm.exception.status, 404)

    def test_duplicate_shelf_rejected(self):
        self.make(); other = deposit(); other["request_id"] = "new-deposit"
        with self.assertRaises(DomainError): self.store.mutate("DEPOSIT", other)

    def test_input_validation(self):
        cases = [("collector", ""), ("collector", "x" * 101), ("collector", "test\nname"), ("quantity", True), ("quantity", 0), ("quantity", 21), ("quantity", "2"), ("custody_confirmed", False), ("operator", " ")]
        for key, value in cases:
            with self.subTest(key=key, value=value):
                data = deposit(); data[key] = value
                with self.assertRaises(DomainError): self.store.mutate("DEPOSIT", data)
        self.assertEqual(len(self.store.state()["packets"]), 0)

    def test_non_object_rejected(self):
        for data in (None, [], "text", 1):
            with self.assertRaises(DomainError): self.store.mutate("DEPOSIT", data)

    def test_version_boolean_not_accepted(self):
        with self.assertRaises(DomainError): self.release(self.make(), version=True)

    def test_search_casefold_and_counts(self):
        self.store.seed()
        self.assertEqual(len(self.store.state("aLeX")["packets"]), 1)
        self.assertEqual(self.store.state()["counts"]["READY"], 3)
        self.assertEqual(self.store.state()["counts"]["PASSES_IN_CUSTODY"], 6)

    def test_seed_is_repeatable(self):
        self.store.seed(); self.store.seed()
        self.assertEqual(len(self.store.state()["packets"]), 3)

    def test_backup_is_integrity_checked_and_no_overwrite(self):
        packet = self.make(); self.release(packet)
        destination = Path(self.temp.name) / "snapshot.sqlite3"
        self.store.backup(destination)
        restored = Store(destination)
        self.assertEqual(restored.get(packet["id"])["status"], "RELEASE_RECORDED")
        with self.assertRaises(DomainError): self.store.backup(destination)


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.temp.name) / "db.sqlite3")
        self.server = Server(("127.0.0.1", 0), self.store)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()
        self.port = self.server.server_address[1]
        response, _ = self.request("GET", "/")
        self.cookie = response.getheader("Set-Cookie").split(";")[0]

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(); self.temp.cleanup()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse(); result = response.read(); connection.close()
        return response, result

    def post(self, body=None, extra=None):
        headers = {"Cookie":self.cookie, "Content-Type":"application/json", "X-CSRF-Token":self.server.csrf, "Origin":f"http://127.0.0.1:{self.port}"}
        headers.update(extra or {})
        return self.request("POST", "/api/deposits", json.dumps(body if body is not None else deposit()), headers)

    def test_session_required_for_read(self):
        response, _ = self.request("GET", "/api/state")
        self.assertEqual(response.status, 401)

    def test_get_state_with_session(self):
        response, body = self.request("GET", "/api/state", headers={"Cookie":self.cookie})
        self.assertEqual(response.status, 200)
        self.assertIn("csrf", json.loads(body))

    def test_api_deposit(self):
        response, body = self.post()
        self.assertEqual(response.status, 200)
        self.assertEqual(json.loads(body)["packet"]["status"], "READY")

    def test_foreign_origin_blocked(self):
        response, _ = self.post(extra={"Origin":"https://malicious.example"})
        self.assertEqual(response.status, 403)
        self.assertEqual(len(self.store.state()["packets"]), 0)

    def test_bad_csrf_blocked(self):
        response, _ = self.post(extra={"X-CSRF-Token":"wrong"})
        self.assertEqual(response.status, 403)

    def test_rebinding_host_blocked(self):
        response, _ = self.request("GET", "/", headers={"Host":"malicious.example"})
        self.assertEqual(response.status, 403)

    def test_non_json_content_type_blocked(self):
        response, _ = self.post(extra={"Content-Type":"text/plain"})
        self.assertEqual(response.status, 415)

    def test_path_traversal_blocked(self):
        response, _ = self.request("GET", "/../../app.py")
        self.assertEqual(response.status, 404)

    def test_bad_json_rejected(self):
        response, _ = self.request("POST", "/api/deposits", body="{broken", headers={"Cookie":self.cookie, "Content-Type":"application/json", "X-CSRF-Token":self.server.csrf})
        self.assertEqual(response.status, 400)

    def test_security_headers(self):
        response, _ = self.request("GET", "/")
        self.assertIn("frame-ancestors 'none'", response.getheader("Content-Security-Policy"))
        self.assertEqual(response.getheader("Cache-Control"), "no-store")
        self.assertIn("HttpOnly", response.getheader("Set-Cookie"))
        self.assertIn("SameSite=Strict", response.getheader("Set-Cookie"))


if __name__ == "__main__":
    unittest.main()
