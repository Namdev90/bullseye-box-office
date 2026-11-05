"""Optional browser checks using an already-installed Playwright and Chromium.

Run: python3 tests/browser_smoke.py
Set CHROMIUM_PATH if your system browser is elsewhere. No software is installed.
"""
import os
from pathlib import Path
import shutil
import sys
import tempfile
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import Store, Server
from playwright.sync_api import sync_playwright, expect


def run():
    with tempfile.TemporaryDirectory() as temp:
        store = Store(Path(temp) / "smoke.sqlite3"); store.seed()
        server = Server(("127.0.0.1", 0), store)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        base = f"http://127.0.0.1:{server.server_address[1]}"
        artifacts = Path(os.environ.get("SMOKE_ARTIFACTS", str(Path(temp) / "screenshots")))
        artifacts.mkdir(parents=True, exist_ok=True)
        try:
            with sync_playwright() as p:
                executable = os.environ.get("CHROMIUM_PATH") or shutil.which("chromium") or shutil.which("google-chrome")
                browser = p.chromium.launch(headless=True, **({"executable_path":executable} if executable else {}))
                context = browser.new_context(viewport={"width":1440,"height":1050})
                page = context.new_page(); errors = []; network = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.on("request", lambda request: network.append(request.url))
                page.goto(base)
                page.locator('#operator-form input').fill("Demo Operator")
                page.get_by_role("button", name="Start desk session").click()
                expect(page.locator('#ready-count')).to_have_text("3")
                page.screenshot(path=str(artifacts / "01-dashboard.png"), full_page=True)

                def make_deposit(name, slot):
                    page.get_by_role("button", name="New deposit").click()
                    page.locator('#deposit-form [name=depositor]').fill("Pat Demo")
                    page.locator('#deposit-form [name=collector]').fill(name)
                    page.locator('#deposit-form [name=quantity]').fill("2")
                    page.locator('#deposit-form [name=location]').fill(slot)
                    page.locator('#deposit-form [name=custody_confirmed]').check()
                    page.get_by_role("button", name="Save deposit").click()

                # Full happy path, wrong physical label, repeat protection.
                make_deposit("Jamie Synthetic", "B-01")
                expect(page.locator('#packet-dialog')).to_contain_text("Deposit saved.")
                code = page.locator('.record-code').inner_text()
                page.screenshot(path=str(artifacts / "02-deposit-receipt.png"), full_page=True)
                page.locator('#packet-dialog').get_by_role("button", name="Done", exact=True).click()
                page.locator('#search').fill("Jamie Synthetic")
                page.get_by_role("button", name="Open packet for Jamie Synthetic").click()
                page.locator('[name=packet_code]').fill("BX-WRONG")
                page.locator('[name=identity_verified]').check()
                page.get_by_role("button", name="Record release", exact=True).click()
                expect(page.locator('#release-error')).to_contain_text("does not match")
                page.locator('[name=packet_code]').fill(code)
                page.get_by_role("button", name="Record release", exact=True).click()
                expect(page.locator('#packet-dialog')).to_contain_text("Physical handover is not confirmed")
                page.screenshot(path=str(artifacts / "03-recorded-release.png"), full_page=True)
                page.locator('[name=handover_confirmed]').check()
                page.get_by_role("button", name="Confirm handover", exact=True).click()
                expect(page.locator('#packet-dialog')).to_contain_text("Collection complete. Do not release again.")
                expect(page.get_by_role("button", name="Record release", exact=True)).to_have_count(0)
                page.locator('#packet-dialog').get_by_role("button", name="Done", exact=True).click()
                page.locator('#search').fill("")
                print("PASS: deposit, label validation, release, physical confirmation, completed record")

                # Commit a deposit but drop the HTTP response; recover the identical request.
                def drop_response(route):
                    route.fetch()
                    route.abort("failed")
                page.route("**/api/deposits", drop_response, times=1)
                make_deposit("Recovery Demo", "B-02")
                expect(page.locator('#deposit-error')).to_contain_text("Outcome uncertain")
                expect(page.locator('#save-deposit')).to_be_disabled()
                page.locator('#deposit-dialog').get_by_role("button", name="Close deposit").click()
                page.get_by_role("button", name="Refresh", exact=False).click()
                page.get_by_role("button", name="Recover saved request").click()
                expect(page.locator('#packet-dialog')).to_contain_text("Deposit saved.")
                expect(page.get_by_role("button", name="Print receipt / label")).to_be_visible()
                self_count = sum(packet["collector"] == "Recovery Demo" for packet in store.state()["packets"])
                assert self_count == 1, self_count
                page.locator('#packet-dialog').get_by_role("button", name="Done", exact=True).click()
                print("PASS: lost deposit response recovers exactly once and retains labeling instructions")

                # Release response lost: fail closed and recover without a second transition.
                page.locator('#search').fill("Recovery Demo")
                page.get_by_role("button", name="Open packet for Recovery Demo").click()
                code = page.locator('.record-code').inner_text()
                page.locator('[name=packet_code]').fill(code)
                page.locator('[name=identity_verified]').check()
                page.route("**/api/packets/*/release", drop_response, times=1)
                page.get_by_role("button", name="Record release", exact=True).click()
                expect(page.locator('#packet-live-warning')).to_be_visible()
                page.locator('#packet-dialog').get_by_role("button", name="Close packet").click()
                page.get_by_role("button", name="Refresh", exact=False).click()
                page.get_by_role("button", name="Recover saved request").click()
                expect(page.locator('#packet-dialog')).to_contain_text("Physical handover is not confirmed")
                packet = next(packet for packet in store.state()["packets"] if packet["collector"] == "Recovery Demo")
                assert packet["version"] == 2
                print("PASS: lost release response stays blocked until current outcome is recovered")

                # A separate window finishes: refresh must invalidate stale physical instructions.
                store.mutate("HANDOVER", {"request_id":"other-window-confirm", "operator":"Demo Operator", "version":packet["version"], "handover_confirmed":True}, packet["id"])
                page.evaluate("refresh()")
                expect(page.locator('#packet-dialog')).to_contain_text("Collection complete. Do not release again.")
                expect(page.locator('#handover-form')).to_have_count(0)
                page.locator('#packet-dialog').get_by_role("button", name="Done", exact=True).click()
                page.locator('#search').fill("")
                print("PASS: changed packet refresh invalidates a stale handover dialog")

                # An unavailable local service disables actions, not just a network indicator.
                page.route("**/api/state", lambda route: route.abort("failed"), times=1)
                page.get_by_role("button", name="Refresh", exact=False).click()
                expect(page.locator('#connection')).to_have_text("Desk connection lost")
                expect(page.locator('#new-deposit')).to_be_disabled()
                page.get_by_role("button", name="Refresh", exact=False).click()
                expect(page.locator('#new-deposit')).to_be_enabled()
                print("PASS: loss of the local authority disables new mutations")

                # Literal markup remains text, not executable HTML.
                make_deposit('<img src=x onerror="window.xss=true">', "C-01")
                expect(page.locator('#packet-dialog img')).to_have_count(0)
                assert page.evaluate("window.xss === undefined")
                page.locator('#packet-dialog').get_by_role("button", name="Done", exact=True).click()
                assert not errors, errors
                assert all(url.startswith(base) for url in network), network
                print("PASS: escaped text, no page JavaScript errors, and no nonlocal network requests")

                page.get_by_role("button", name="Activity log", exact=False).click()
                expect(page.locator('#activity-list')).to_contain_text("Physical handover confirmed")
                page.get_by_role("button", name="Recovery guide", exact=False).click()
                expect(page.locator('#guide-view')).to_contain_text("One paper ledger, one release point")
                page.get_by_role("button", name="Pass custody", exact=False).click()
                page.set_viewport_size({"width":390,"height":844})
                page.screenshot(path=str(artifacts / "04-mobile.png"), full_page=True)
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), "Page overflow outside the intended table scroller"
                print("PASS: activity, recovery guide, and narrow-screen layout")
                browser.close()
                print(f"Browser smoke checks complete. Screenshots: {artifacts}")
        finally:
            server.shutdown(); server.server_close(); thread.join()


if __name__ == "__main__":
    run()
