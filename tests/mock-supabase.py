"""Servidor Supabase FALSO (só para testes): imita os endpoints REST/Storage/Auth que o MIXMIND usa,
incluindo as regras RLS essenciais (anon só envia; admin lê/aprova/apaga). `python3 tests/mock-supabase.py 8766`"""
import json, sys, uuid, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
ANON, ADMIN_TOKEN, ADMIN = 'anon-key', 'admin-token', ('admin@piradex.test', 'pw')
DB = {'submissions': [], 'library_tracks': []}; FILES = {}
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*'); self.send_header('Access-Control-Allow-Headers', '*'); self.send_header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
    def out(self, code, body=None, ctype='application/json'):
        b = body if isinstance(body, bytes) else (json.dumps(body).encode() if body is not None else b'')
        self.send_response(code); self.cors(); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_OPTIONS(self): self.out(204)
    def body(self):
        n = int(self.headers.get('Content-Length') or 0); return self.rfile.read(n) if n else b''
    def who(self):
        if self.headers.get('apikey') != ANON: return None
        a = self.headers.get('Authorization', '')
        return 'admin' if a == 'Bearer ' + ADMIN_TOKEN else 'anon' if a == 'Bearer ' + ANON else None
    def route(self, method):
        u = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(u.query); p = urllib.parse.unquote(u.path); w = self.who()
        if p == '/__state': return self.out(200, {'db': DB, 'files': list(FILES.keys())})
        if p == '/auth/v1/token' and method == 'POST':
            j = json.loads(self.body() or b'{}')
            if (j.get('email'), j.get('password')) == ADMIN: return self.out(200, {'access_token': ADMIN_TOKEN, 'expires_in': 3600, 'user': {'email': ADMIN[0]}})
            return self.out(400, {'error_description': 'Invalid login credentials'})
        if w is None: return self.out(401, {'message': 'no api key'})
        if p.startswith('/storage/v1/object/'):
            rest = p[len('/storage/v1/object/'):]
            if method == 'POST':
                bucket, path = rest.split('/', 1)
                if not path.startswith('incoming/'): return self.out(403, {'message': 'RLS'})
                if path in FILES: return self.out(409, {'message': 'exists'})
                FILES[path] = self.body(); return self.out(200, {'Key': bucket + '/' + path})
            if method == 'GET' and rest.startswith('authenticated/'):
                if w != 'admin': return self.out(400, {'message': 'Object not found'})
                path = rest.split('/', 2)[2]
                return self.out(200, FILES[path], 'audio/wav') if path in FILES else self.out(404, {'message': 'not found'})
            if method == 'DELETE':
                if w != 'admin': return self.out(403, {'message': 'RLS'})
                for x in json.loads(self.body() or b'{}').get('prefixes', []): FILES.pop(x, None)
                return self.out(200, [])
        if p.startswith('/rest/v1/'):
            t = p[len('/rest/v1/'):]
            if t not in DB: return self.out(404, {'message': 'no table'})
            if method == 'POST':
                row = json.loads(self.body())
                if t == 'submissions':
                    if row.get('status', 'pending') != 'pending' or not row.get('rights_ok'): return self.out(403, {'message': 'RLS'})
                    row.update(id=str(uuid.uuid4()), status='pending', created_at='2026-10-07T10:00:00Z')
                elif w != 'admin': return self.out(403, {'message': 'RLS'})
                else: row.update(id=str(uuid.uuid4()), created_at='2026-10-07T11:00:00Z')
                DB[t].append(row); return self.out(201)
            rows = DB[t]
            if t == 'submissions' and w != 'admin': rows = []  # RLS: anon não lê
            for k, v in q.items():
                if k in ('select', 'order', 'limit'): continue
                op, val = v[0].split('.', 1)
                rows = [r for r in rows if str(r.get(k)) == val]
            if method == 'GET': return self.out(200, rows)
            if method == 'PATCH':
                if w != 'admin': return self.out(403, {'message': 'RLS'})
                ch = json.loads(self.body())
                for r in rows: r.update(ch)
                return self.out(204)
        return self.out(404, {'message': 'route'})
    def do_GET(self): self.route('GET')
    def do_POST(self): self.route('POST')
    def do_PATCH(self): self.route('PATCH')
    def do_DELETE(self): self.route('DELETE')
ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1] if len(sys.argv) > 1 else 8766)), H).serve_forever()
