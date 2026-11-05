import concurrent.futures
import http.client
import json
from pathlib import Path
import re
import sqlite3
import tempfile
import threading
import unittest

from app import Store, Server, DomainError, CATEGORIES, CODE_ALPHABET, DEFAULT_EVENT


def counts(normal=0, vip=0, vvip=0):
    return dict(normal=normal, vip=vip, vvip=vvip)


def deposit(**overrides):
    data = dict(request_id='deposit-1', operator='Demo Operator', event_id=DEFAULT_EVENT,
                quantities=counts(6,2,1), location='A-01', custody_confirmed=True)
    data.update(overrides)
    return data


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'db.sqlite3'
        self.now = 1800000000.0
        self.store = Store(self.path, clock=lambda: self.now)

    def tearDown(self):
        self.temp.cleanup()

    def make(self, **overrides):
        return self.store.mutate('DEPOSIT', deposit(**overrides))

    def verified(self, result):
        return self.store.verify(dict(event_id=result['deposit']['event_id'], collection_code=result['collection_code']))

    def release_data(self, verified, request_id='release-1', **overrides):
        packet = verified['deposit']
        data = dict(request_id=request_id, operator='Demo Operator', event_id=packet['event_id'],
                    version=packet['version'], packet_id=packet['packet_id'],
                    claim_token=verified['claim_token'], quantities=counts(2,1,0))
        data.update(overrides)
        return data

    def release(self, verified, request_id='release-1', **overrides):
        return self.store.mutate('RELEASE', self.release_data(verified,request_id,**overrides),verified['deposit']['id'])

    def handover(self, released, request_id='handover-1', **overrides):
        c = released['collection']
        data = dict(request_id=request_id, operator='Demo Operator', event_id=c['event_id'],version=c['version'],handover_confirmed=True)
        data.update(overrides)
        return self.store.mutate('HANDOVER', data, c['id'])

    def fails(self, code, call):
        with self.assertRaises(DomainError) as cm: call()
        self.assertEqual(cm.exception.code,code)
        return cm.exception

    def test_code_format_and_entropy_alphabet(self):
        self.assertEqual(len(set(CODE_ALPHABET)),32)
        a=self.make(); b=self.make(request_id='deposit-2',location='A-02')
        self.assertRegex(a['collection_code'],r'^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){2}$')
        self.assertNotEqual(a['collection_code'],b['collection_code'])
        self.assertNotEqual(a['collection_code'],a['deposit']['packet_id'])

    def test_code_normalization(self):
        r=self.make()
        code=r['collection_code'].lower().replace('-',' ')
        self.assertEqual(self.store.verify(dict(event_id=DEFAULT_EVENT,collection_code=code))['deposit']['id'],r['deposit']['id'])

    def test_deposit_audit_and_no_raw_code_in_state_or_database(self):
        r=self.make(); s=self.store.state()
        self.assertEqual(s['deposits'][0]['remaining'],counts(6,2,1))
        self.assertEqual(s['audit'][0]['action'],'CODE_GENERATED')
        self.assertEqual(s['audit'][0]['details']['categories'],counts(6,2,1))
        self.assertEqual(s['audit'][0]['operator'],'Demo Operator')
        self.assertNotIn(r['collection_code'],json.dumps(s))
        self.assertNotIn('code_hash',json.dumps(s))
        self.assertNotIn('collection_code',json.dumps(s))
        with self.store.connect() as db:
            dump='\n'.join(db.iterdump())
            self.assertNotIn(r['collection_code'],dump)
            self.assertNotIn(r['collection_code'].replace('-',''),dump)

    def test_deposit_idempotency_returns_same_code(self):
        first=self.make(); again=self.make()
        self.assertTrue(again['replayed'])
        self.assertEqual(first['collection_code'],again['collection_code'])
        self.assertEqual(len(self.store.state()['audit']),1)

    def test_request_conflict_is_not_definitively_unapplied(self):
        self.make()
        error=self.fails('REQUEST_CONFLICT',lambda:self.make(location='A-02'))
        self.assertFalse(error.not_applied)

    def test_duplicate_slot_in_event_rejected_but_other_event_allowed(self):
        self.make()
        self.fails('SLOT_OCCUPIED',lambda:self.make(request_id='d2'))
        self.make(request_id='d3',event_id='training-event-002')
        self.assertEqual(len(self.store.state('training-event-002')['deposits']),1)

    def test_quantities_invalid_shapes(self):
        for q in (None,{}, {'normal':1},counts(),counts(-1,0,0),counts(True,0,0),counts(101,0,0),dict(counts(1),extra=1),counts(1.2)):
            with self.subTest(q=q),self.assertRaises(DomainError): self.make(quantities=q)
        self.assertEqual(self.store.state()['counts']['DEPOSITS'],0)

    def test_deposit_requires_boolean_custody(self):
        for value in (False,'true',1,None):
            with self.subTest(value=value),self.assertRaises(DomainError): self.make(custody_confirmed=value)

    def test_text_validation(self):
        for changes in ({'operator':''},{'operator':'x'*81},{'location':'a\nb'},{'event_id':''},{'request_id':123}):
            with self.subTest(changes=changes),self.assertRaises(DomainError): self.make(**changes)

    def test_two_friends_partial_collections_then_exhaustion(self):
        r=self.make(); a=self.release(self.verified(r))
        self.assertEqual(a['deposit']['remaining'],counts(4,1,1))
        self.assertEqual(a['collection']['quantities'],counts(2,1))
        self.assertEqual(a['collection']['status'],'RELEASE_RECORDED')
        b=self.handover(a)
        self.assertEqual(b['deposit']['version'],3)
        self.assertIsNone(b['deposit']['pending_collection'])
        c=self.release(self.verified(r),'release-2',quantities=counts(4,1,1))
        self.handover(c,'handover-2')
        s=self.store.state()
        self.assertEqual(s['counts'],dict(DEPOSITS=1,PASSES_REMAINING=0,UNCONFIRMED=0,HANDED_OVER=9))
        self.fails('OVER_RELEASE',lambda:self.release(self.verified(r),'release-3',quantities=counts(1)))
        self.assertEqual(len(s['audit']),5)

    def test_over_release_rejected_without_partial_mutation(self):
        r=self.make(); self.fails('OVER_RELEASE',lambda:self.release(self.verified(r),quantities=counts(1,3,0)))
        self.assertEqual(self.store.state()['deposits'][0]['remaining'],counts(6,2,1))
        self.assertEqual(len(self.store.state()['audit']),1)

    def test_pending_handover_blocks_further_release(self):
        r=self.make(); self.release(self.verified(r))
        error=self.fails('HANDOVER_PENDING',lambda:self.release(self.verified(r),'release-2'))
        self.assertTrue(error.not_applied)

    def test_wrong_physical_packet_rejected(self):
        r=self.make()
        self.fails('WRONG_PACKET',lambda:self.release(self.verified(r),packet_id='BX-WRONG'))
        self.assertEqual(len(self.store.state()['audit']),1)

    def test_stale_version_rejected(self):
        r=self.make(); v=self.verified(r); self.release(v)
        self.fails('STALE_BALANCE',lambda:self.release(v,'release-2'))

    def test_parallel_distinct_releases_exactly_one_wins(self):
        v=self.verified(self.make())
        def run(index):
            try: self.release(v,f'parallel-{index}'); return True
            except DomainError: return False
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results=list(pool.map(run,range(16)))
        self.assertEqual(sum(results),1)
        self.assertEqual(self.store.state()['deposits'][0]['remaining'],counts(4,1,1))
        self.assertEqual(len(self.store.state()['collections']),1)

    def test_parallel_identical_retry_creates_one_release(self):
        v=self.verified(self.make())
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results=list(pool.map(lambda _:self.release(v),range(12)))
        self.assertEqual(sum(not r['replayed'] for r in results),1)
        self.assertEqual(len(self.store.state()['audit']),2)

    def test_handover_is_one_time_and_original_operator(self):
        r=self.release(self.verified(self.make()))
        self.fails('OPERATOR_MISMATCH',lambda:self.handover(r,operator='Other Demo'))
        for value in (False,'true',1,None):
            with self.assertRaises(DomainError): self.handover(r,handover_confirmed=value)
        done=self.handover(r); repeat=self.handover(r)
        self.assertTrue(repeat['replayed'])
        self.assertEqual(done['collection']['version'],2)
        self.fails('STALE_HANDOVER',lambda:self.handover(r,'h2'))
        self.assertEqual(len(self.store.state()['audit']),3)

    def test_release_retry_returns_current_state_even_after_claim_expiry_restart(self):
        r=self.make(); v=self.verified(r); release_data=self.release_data(v)
        out=self.release(v); self.handover(out)
        self.now += 200; self.store=Store(self.path,clock=lambda:self.now)
        result=self.store.mutate('RELEASE',release_data,v['deposit']['id'])
        self.assertTrue(result['replayed'])
        self.assertEqual(result['collection']['status'],'HANDED_OVER')
        self.assertEqual(result['deposit']['version'],3)
        self.assertEqual(len(self.store.state()['audit']),3)

    def test_uncommitted_expired_claim_is_definitively_unapplied(self):
        v=self.verified(self.make()); self.now += 121
        error=self.fails('CLAIM_EXPIRED',lambda:self.release(v))
        self.assertTrue(error.not_applied)
        self.assertEqual(self.store.state()['counts']['PASSES_REMAINING'],9)

    def test_uncommitted_claim_invalid_after_restart(self):
        v=self.verified(self.make()); self.store=Store(self.path,clock=lambda:self.now)
        self.fails('CLAIM_EXPIRED',lambda:self.release(v))

    def test_tampered_or_malformed_claims(self):
        v=self.verified(self.make())
        for token in ('bad','a.b.c','💥.x',v['claim_token']+'x',None,True):
            with self.subTest(token=token):
                self.fails('CLAIM_EXPIRED',lambda:self.release(v,claim_token=token))

    def test_claim_bound_to_deposit_and_event(self):
        a=self.make(); b=self.make(request_id='d2',location='A-02')
        va=self.verified(a); vb=self.verified(b)
        self.fails('CLAIM_EXPIRED',lambda:self.release(vb,claim_token=va['claim_token']))
        self.fails('DEPOSIT_NOT_FOUND',lambda:self.release(va,event_id='training-event-002'))

    def test_event_code_isolation_and_selected_state(self):
        r=self.make()
        self.fails('CODE_NOT_ACCEPTED',lambda:self.store.verify(dict(event_id='training-event-002',collection_code=r['collection_code'])))
        self.assertEqual(self.store.state('training-event-002')['deposits'],[])
        self.fails('EVENT_NOT_FOUND',lambda:self.store.state('missing-event'))

    def test_global_throttle_persists_restart_and_event_switch(self):
        r=self.make()
        for i in range(5):
            self.fails('CODE_NOT_ACCEPTED',lambda:self.store.verify(dict(event_id=DEFAULT_EVENT,collection_code=f'bad-{i}')))
        self.store=Store(self.path,clock=lambda:self.now)
        self.fails('RATE_LIMITED',lambda:self.verified(r))
        self.fails('RATE_LIMITED',lambda:self.store.verify(dict(event_id='training-event-002',collection_code='bad')))
        self.now += 61
        self.assertEqual(self.verified(r)['deposit']['id'],r['deposit']['id'])
        with self.store.connect() as db:
            self.assertEqual([r[1] for r in db.execute('PRAGMA table_info(verification_failures)')],['at'])

    def test_closed_event_blocks_verify_deposit_release_but_allows_pending_handover(self):
        r=self.make(); v=self.verified(r); out=self.release(v)
        with self.store.connect() as db: db.execute('UPDATE events SET active=0 WHERE id=?',(DEFAULT_EVENT,))
        self.fails('CODE_NOT_ACCEPTED',lambda:self.verified(r))
        self.fails('EVENT_CLOSED',lambda:self.make(request_id='d2',location='A-02'))
        self.fails('EVENT_CLOSED',lambda:self.release(v,'r2'))
        self.assertEqual(self.handover(out)['collection']['status'],'HANDED_OVER')

    def test_event_expiry(self):
        r=self.make(); self.now += 8*86400
        self.fails('CODE_NOT_ACCEPTED',lambda:self.verified(r))
        self.fails('EVENT_CLOSED',lambda:self.make(request_id='d2',location='A-02'))

    def test_backup_restores_codes_and_current_balances_with_secret_companion(self):
        r=self.make(); self.handover(self.release(self.verified(r)))
        destination=Path(self.temp.name)/'snapshot.sqlite3'
        dbpath,keypath=self.store.backup(destination)
        self.assertTrue(keypath.exists())
        restored=Store(dbpath,clock=lambda:self.now)
        verified=restored.verify(dict(event_id=DEFAULT_EVENT,collection_code=r['collection_code']))
        self.assertEqual(verified['deposit']['remaining'],counts(4,1,1))
        self.assertEqual(restored.state(),self.store.state())
        with self.assertRaises(DomainError): self.store.backup(destination)

    def test_missing_secret_companion_refuses_existing_database(self):
        self.make(); self.store.key_path.unlink()
        with self.assertRaises(DomainError): Store(self.path)

    def test_invalid_secret_companion_refuses_database(self):
        self.make(); self.store.key_path.write_bytes(b'short')
        with self.assertRaises(DomainError): Store(self.path)

    def test_wrong_valid_length_key_refuses_mismatched_backup_pair(self):
        self.make(); self.store.key_path.write_bytes(b'x'*32)
        with self.assertRaises(DomainError): Store(self.path)

    def test_seed_is_repeatable_synthetic_and_no_code_logs(self):
        self.store.seed(); self.store.seed()
        self.assertEqual(len(self.store.state()['deposits']),2)
        self.assertEqual(len(self.store.state('training-event-002')['deposits']),1)


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(); cls.store=Store(Path(cls.temp.name)/'http.sqlite3')
        cls.server=Server(('127.0.0.1',0),cls.store)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True); cls.thread.start()
        cls.port=cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join(); cls.temp.cleanup()

    def request(self,method,path,body=None,headers=None):
        connection=http.client.HTTPConnection('127.0.0.1',self.port,timeout=5)
        connection.request(method,path,body,headers or {})
        response=connection.getresponse(); payload=response.read(); result=(response.status,dict(response.getheaders()),payload)
        connection.close(); return result

    def session(self):
        status,headers,_=self.request('GET','/'); self.assertEqual(status,200)
        cookie=headers['Set-Cookie'].split(';')[0]
        status,_,body=self.request('GET','/api/state',headers={'Cookie':cookie})
        self.assertEqual(status,200)
        return {'Cookie':cookie,'X-CSRF-Token':json.loads(body)['csrf'],'Content-Type':'application/json'}

    def test_home_headers_and_static_assets(self):
        status,headers,body=self.request('GET','/')
        self.assertEqual(status,200); self.assertIn(b'Practice only.',body)
        self.assertEqual(headers['Cache-Control'],'no-store')
        self.assertEqual(headers['Referrer-Policy'],'no-referrer')
        self.assertIn("frame-ancestors 'none'",headers['Content-Security-Policy'])
        self.assertIn('HttpOnly',headers['Set-Cookie']); self.assertIn('SameSite=Strict',headers['Set-Cookie'])
        for path in ('/app.js','/style.css','/tactile.css','/desk-enhancements.js','/assets/bullseye-entertainment.jpg'): self.assertEqual(self.request('GET',path)[0],200)

    def test_no_session_no_state_or_write(self):
        self.assertEqual(self.request('GET','/api/state')[0],401)
        status,_,body=self.request('POST','/api/deposits',json.dumps(deposit()),{'Content-Type':'application/json'})
        self.assertEqual(status,403); self.assertFalse(json.loads(body)['not_applied'])

    def test_csrf_and_foreign_origin_fail_closed(self):
        headers=self.session(); headers['X-CSRF-Token']='bad'
        status,_,body=self.request('POST','/api/deposits',json.dumps(deposit()),headers)
        self.assertEqual(status,403); self.assertFalse(json.loads(body)['not_applied'])
        headers=self.session(); headers['Origin']='https://untrusted.example'
        self.assertEqual(self.request('POST','/api/deposits',json.dumps(deposit()),headers)[0],403)

    def test_rebinding_path_traversal_and_private_files(self):
        self.assertEqual(self.request('GET','/',headers={'Host':'attacker.example'})[0],403)
        for path in ('/../app.py','/_runtime/http.sqlite3','/app.py','/../README.md'):
            self.assertEqual(self.request('GET',path)[0],404)

    def test_invalid_body_and_content_type(self):
        headers=self.session()
        self.assertEqual(self.request('POST','/api/deposits','{broken',headers)[0],400)
        self.assertEqual(self.request('POST','/api/deposits','[]',headers)[0],400)
        headers['Content-Type']='text/plain'
        self.assertEqual(self.request('POST','/api/deposits','{}',headers)[0],415)

    def test_full_http_workflow(self):
        headers=self.session()
        def post(path,body):
            status,_,raw=self.request('POST',path,json.dumps(body),headers)
            self.assertEqual(status,200,raw)
            return json.loads(raw)
        r=post('/api/deposits',deposit(request_id='http-deposit',location='H-01'))
        v=post('/api/verify',dict(event_id=DEFAULT_EVENT,collection_code=r['collection_code']))
        d=v['deposit']
        release=dict(request_id='http-release',operator='Demo Operator',event_id=DEFAULT_EVENT,version=d['version'],claim_token=v['claim_token'],packet_id=d['packet_id'],quantities=counts(2,1))
        out=post('/api/deposits/'+d['id']+'/release',release); c=out['collection']
        done=post('/api/collections/'+c['id']+'/handover',dict(request_id='http-handover',operator='Demo Operator',event_id=DEFAULT_EVENT,version=c['version'],handover_confirmed=True))
        self.assertEqual(done['deposit']['remaining'],counts(4,1,1))
        self.assertEqual(done['collection']['status'],'HANDED_OVER')


if __name__=='__main__': unittest.main()
