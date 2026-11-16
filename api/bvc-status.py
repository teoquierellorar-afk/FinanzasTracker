"""
Vercel Python Serverless Function para /api/bvc-status.
Reutiliza build_bvc_status de server.py para evitar duplicar lógica.
"""

from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import json
import sys

ROOT_DIR = str(Path(__file__).resolve().parent.parent)
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from server import build_bvc_status  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        symbol = qs.get("symbol", ["ICOLCAP.CL"])[0]

        payload = build_bvc_status(symbol)
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # Cache en CDN de Vercel por 5 minutos (300 s) cuando la consulta fue exitosa
        cache_header = "s-maxage=300, stale-while-revalidate=60" if payload.get("status") == "live" else "no-store"
        self.send_header("Cache-Control", cache_header)
        self.end_headers()
        self.wfile.write(body)
