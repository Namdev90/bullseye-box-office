"""Desktop and Android-emulator Origin requests share one safe, durable SQLite authority."""
from pathlib import Path
import http.client
import json
import tempfile
import threading
import unittest
from app import Store, Server, DEFAULT_EVENT


class SharedBridgeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.tmp.name)/'desk.sqlite3')
        self.server = Server(('127.0.0.1',0),self.store,allow_android_emulator=True)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.tmp.cleanup()

    def call(self,host,verb,path,payload=None,cookie=None,csrf=None):
        headers={'Host':f'{host}:{self.port}'}
        if cookie: headers['Cookie']=cookie
        if payload is not None:
            headers['Content-Type']='application/json'; headers['Origin']=f'http://{host}:{self.port}'
            if csrf: headers['X-CSRF-Token']=csrf
        conn=http.client.HTTPConnection('127.0.0.1',self.port,timeout=5)
        conn.request(verb,path,json.dumps(payload) if payload is not None else None,headers)
        resp=conn.getresponse();raw=resp.read();response=(resp.status,dict(resp.getheaders()),raw)
        conn.close()
        return response

    def session(self,host):
        s,h,body=self.call(host,'GET','/');self.assertEqual(s,200,body)
        cookie=h['Set-Cookie'].split(';')[0]
        s,h,raw=self.call(host,'GET','/api/state',cookie=cookie);self.assertEqual(s,200,raw)
        return cookie,json.loads(raw)['csrf']

    def post(self,host,path,payload,cookie,csrf):
        status,headers,raw=self.call(host,'POST',path,payload,cookie,csrf)
        self.assertEqual(status,200,raw)
        return json.loads(raw)

    def test_strict_origins_and_branded_resources(self):
        for path in ('/assets/sharepass-latest-lockup.webp','/assets/sharepass-ticket-mark.webp','/sharepass-brand.css'):
            status,headers,data=self.call('10.0.2.2','GET',path)
            self.assertEqual(status,200,path)
            self.assertGreater(len(data),100)
        for host in ('attacker.test','127.0.0.2','10.0.2.3','192.168.1.10'):
            self.assertEqual(self.call(host,'GET','/')[0],403)
        self.assertEqual(self.call('10.0.2.2','GET','/api/state')[0],401)

    def test_cross_host_atomic_deposit_and_two_partial_handovers(self):
        pc,pt=self.session('127.0.0.1')
        ac,at=self.session('10.0.2.2')
        event_id=DEFAULT_EVENT
        deposit=dict(request_id='desk-deposit-a',operator='Demo Staff',event_id=event_id,
                     location='A1',quantities={'normal':5,'vip':2,'vvip':1},custody_confirmed=True)
        a=self.post('127.0.0.1','/api/deposits',deposit,pc,pt)
        code=a['collection_code'];self.assertEqual(len(code),14)
        status,_,raw=self.call('10.0.2.2','GET','/api/state?event_id='+event_id,cookie=ac)
        self.assertEqual(status,200)
        state=json.loads(raw)
        self.assertEqual(state['deposits'][0]['id'],a['deposit']['id'])
        self.assertNotIn(code,raw.decode())
        verify=self.post('10.0.2.2','/api/verify',dict(event_id=event_id,collection_code=code),ac,at)
        d=verify['deposit']
        release=dict(request_id='emulator-release-one',operator='Demo Staff',event_id=event_id,
                     claim_token=verify['claim_token'],version=d['version'],packet_id=d['packet_id'],
                     quantities={'normal':2,'vip':0,'vvip':1})
        first=self.post('10.0.2.2',f"/api/deposits/{d['id']}/release",release,ac,at)
        self.assertEqual(first['deposit']['remaining'],{'normal':3,'vip':2,'vvip':0})
        # Replayed POST after a lost network response never releases passes twice.
        replay=self.post('10.0.2.2',f"/api/deposits/{d['id']}/release",release,ac,at)
        self.assertTrue(replay['replayed'])
        pending=first['collection'];self.assertEqual(pending['status'],'RELEASE_RECORDED')
        confirmed=self.post('127.0.0.1',f"/api/collections/{pending['id']}/handover",
                           dict(request_id='desk-handover-one',operator='Demo Staff',event_id=event_id,
                                version=pending['version'],handover_confirmed=True),pc,pt)
        self.assertEqual(confirmed['collection']['status'],'HANDED_OVER')
        again=self.post('127.0.0.1','/api/verify',dict(event_id=event_id,collection_code=code),pc,pt)
        d=again['deposit']
        second=self.post('127.0.0.1',f"/api/deposits/{d['id']}/release",
                         dict(request_id='desk-release-two',operator='Demo Staff',event_id=event_id,
                              claim_token=again['claim_token'],version=d['version'],packet_id=d['packet_id'],
                              quantities={'normal':1,'vip':2,'vvip':0}),pc,pt)
        self.assertEqual(second['deposit']['remaining'],{'normal':2,'vip':0,'vvip':0})
        status,_,raw=self.call('10.0.2.2','GET','/api/state?event_id='+event_id,cookie=ac)
        self.assertEqual(status,200)
        self.assertEqual(json.loads(raw)['deposits'][0]['remaining'],{'normal':2,'vip':0,'vvip':0})

    def test_alias_disabled_by_default(self):
        self.server.shutdown();self.server.server_close();self.thread.join()
        self.server=Server(('127.0.0.1',0),self.store)
        self.port=self.server.server_address[1];self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.assertEqual(self.call('10.0.2.2','GET','/')[0],403)
        self.assertEqual(self.call('127.0.0.1','GET','/')[0],200)

if __name__=='__main__': unittest.main()
