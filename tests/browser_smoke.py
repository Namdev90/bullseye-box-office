"""Optional real-browser checks. Not passed in the build environment.

Requires already-installed Playwright and Chromium. No installation is performed.
Run: python3 tests/browser_smoke.py
Set CHROMIUM_PATH if needed. Screenshots contain synthetic codes; keep private.
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
        store=Store(Path(temp)/'smoke.sqlite3')
        server=Server(('127.0.0.1',0),store)
        thread=threading.Thread(target=server.serve_forever,daemon=True); thread.start()
        base=f'http://127.0.0.1:{server.server_address[1]}'
        artifacts=Path(os.environ.get('SMOKE_ARTIFACTS',str(Path(temp)/'screenshots')))
        artifacts.mkdir(parents=True,exist_ok=True)
        try:
            with sync_playwright() as p:
                executable=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('google-chrome')
                browser=p.chromium.launch(headless=True,**({'executable_path':executable} if executable else {}))
                context=browser.new_context(viewport={'width':1440,'height':1050},reduced_motion='reduce')
                page=context.new_page(); errors=[]; network=[]
                page.on('pageerror',lambda error:errors.append(str(error)))
                page.on('request',lambda request:network.append(request.url))
                page.goto(base)
                page.locator('#operator-form input').fill('Demo Operator')
                page.get_by_role('button',name='Start desk session').click()
                expect(page.locator('#new-deposit')).to_be_enabled()
                page.screenshot(path=str(artifacts/'01-dashboard.png'),full_page=True)

                def make_deposit(slot):
                    page.locator('#new-deposit').click()
                    page.locator('#deposit-form [name=normal]').fill('6')
                    page.locator('#deposit-form [name=vip]').fill('2')
                    page.locator('#deposit-form [name=vvip]').fill('1')
                    page.locator('#deposit-form [name=location]').fill(slot)
                    page.locator('#deposit-form [name=custody_confirmed]').check()
                    page.locator('#save-deposit').click()

                make_deposit('A-01')
                expect(page.locator('#packet-dialog')).to_contain_text('Deposit saved.')
                code=page.locator('.code-slip > strong').inner_text()
                packet_id=page.locator('.record-code').inner_text()
                assert len(code.replace('-',''))==12
                page.screenshot(path=str(artifacts/'02-private-receipt.png'),full_page=True)
                page.locator('.share-options > summary').click()
                page.locator('#share-form [name=phone]').fill('+12025550123')
                page.get_by_role('button',name='Preview message locally').click()
                expect(page.locator('#share-preview')).to_contain_text('Nothing is sent automatically.')
                # Inspect only; never click the third-party handoff or send a message.
                assert page.locator('#share-preview a').get_attribute('href').startswith('https://wa.me/12025550123?text=')
                page.locator('#packet-dialog').get_by_role('button',name='Done',exact=True).click()
                expect(page.locator('.code-slip')).to_have_count(0)

                def verify_code():
                    page.locator('#collect-code').click()
                    page.locator('#collection-code').fill(code)
                    page.get_by_role('button',name='Verify code',exact=True).click()
                    expect(page.locator('#release-form')).to_be_visible()

                verify_code()
                page.locator('#release-form [name=normal]').fill('2')
                page.locator('#release-form [name=vip]').fill('1')
                page.locator('#release-form [name=packet_id]').fill('BX-WRONG')
                page.get_by_role('button',name='Record selected release').click()
                expect(page.locator('#release-error')).to_contain_text('does not match')
                page.locator('#release-form [name=packet_id]').fill(packet_id)
                page.get_by_role('button',name='Record selected release').click()
                expect(page.locator('#packet-dialog')).to_contain_text('Release recorded. Handover unconfirmed.')
                page.locator('#handover-form [name=handover_confirmed]').check()
                page.get_by_role('button',name='Confirm physical handover').click()
                expect(page.locator('.verified-state')).to_contain_text('Verified.')
                expect(page.locator('.verified-state')).to_contain_text('4 Normal · 1 VIP · 1 VVIP')
                page.screenshot(path=str(artifacts/'03-verified.png'),full_page=True)
                page.locator('#packet-dialog').get_by_role('button',name='Done',exact=True).click()

                # A second friend can collect exactly the remaining categories.
                verify_code()
                for category,number in [('normal','4'),('vip','1'),('vvip','1')]:
                    page.locator(f'#release-form [name={category}]').fill(number)
                page.locator('#release-form [name=packet_id]').fill(packet_id)
                page.get_by_role('button',name='Record selected release').click()
                page.locator('#handover-form [name=handover_confirmed]').check()
                page.get_by_role('button',name='Confirm physical handover').click()
                expect(page.locator('.verified-state')).to_contain_text('0 Normal · 0 VIP · 0 VVIP')
                page.locator('#packet-dialog').get_by_role('button',name='Done',exact=True).click()
                assert store.state()['counts']['PASSES_REMAINING']==0
                assert store.state()['counts']['HANDED_OVER']==9

                # A committed deposit with a lost response recovers only once.
                def drop_response(route): route.fetch(); route.abort('failed')
                page.route('**/api/deposits',drop_response,times=1)
                make_deposit('A-02')
                expect(page.locator('#deposit-error')).to_contain_text('Outcome uncertain')
                page.locator('#deposit-dialog').get_by_role('button',name='Close deposit').click()
                page.locator('#refresh').click()
                page.get_by_role('button',name='Recover saved request').click()
                expect(page.locator('#packet-dialog')).to_contain_text('Deposit saved.')
                assert sum(d['location']=='A-02' for d in store.state()['deposits'])==1
                page.locator('#packet-dialog').get_by_role('button',name='Done',exact=True).click()

                page.route('**/api/state*',lambda route:route.abort('failed'),times=1)
                page.locator('#refresh').click()
                expect(page.locator('#connection')).to_have_text('Desk connection lost')
                expect(page.locator('#collect-code')).to_be_disabled()
                page.locator('#refresh').click()
                expect(page.locator('#collect-code')).to_be_enabled()
                page.locator('#nav-activity').click()
                expect(page.locator('#activity-list')).to_contain_text('CODE_GENERATED')
                assert code not in page.locator('#activity-list').inner_text()
                page.locator('#nav-packets').click()
                page.set_viewport_size({'width':390,'height':844})
                page.screenshot(path=str(artifacts/'04-narrow-layout.png'),full_page=True)
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Unexpected page overflow'
                assert not errors,errors
                assert all(url.startswith(base) for url in network),network
                assert not page.evaluate("[...Array(sessionStorage.length)].map((_,i)=>sessionStorage.getItem(sessionStorage.key(i))).join('').includes("+repr(code)+")")
                browser.close()
                print('PASS: shared partial collection, manual WhatsApp preview without transmission, retry recovery, offline block and layout checks.')
                print(f'Private synthetic screenshots: {artifacts}')
        finally:
            server.shutdown(); server.server_close(); thread.join()


if __name__=='__main__': run()
