#!/usr/bin/env python3
"""
Servidor local para FinanzasFlow.
Sirve los archivos estáticos y expone GET /api/bvc-status?symbol=... con datos
de mercado para acciones específicas de la BVC, ETFs y fondos de inversión,
además de la TRM oficial desde Datos Abiertos Colombia.
Solo utiliza la librería estándar de Python 3.
"""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import json
import math
import time
import urllib.request

PORT = 8080
BASE_DIR = Path(__file__).resolve().parent
CACHE_TTL_SECONDS = 300  # 5 minutos

# Catálogo de activos con posibles tickers de respaldo (ej. ADR si el .CL no responde)
ASSET_CATALOG = {
    "ICOLCAP.CL": {"label": "MSCI COLCAP (ETF BVC)", "fallbacks": ["GXG"]},
    "ECOPETROL.CL": {"label": "Ecopetrol (BVC)", "fallbacks": ["EC"]},
    "PFBCOLOM.CL": {"label": "Bancolombia Pref. (BVC)", "fallbacks": ["CIB"]},
    "ISA.CL": {"label": "ISA Interconexión Eléctrica (BVC)", "fallbacks": []},
    "GEB.CL": {"label": "Grupo Energía Bogotá (BVC)", "fallbacks": []},
    "GRUPOSURA.CL": {"label": "Grupo Sura (BVC)", "fallbacks": []},
    "CEMARGOS.CL": {"label": "Cementos Argos (BVC)", "fallbacks": []},
    "NUTRESA.CL": {"label": "Grupo Nutresa (BVC)", "fallbacks": []},
    "AVAL": {"label": "Grupo Aval (ADR BVC/NYSE)", "fallbacks": []},
    "GXG": {"label": "Global X MSCI Colombia ETF", "fallbacks": []},
    "SPY": {"label": "S&P 500 ETF (SPY)", "fallbacks": []},
    "QQQ": {"label": "Nasdaq 100 ETF (QQQ)", "fallbacks": []},
    "VT": {"label": "Vanguard Total World ETF (VT)", "fallbacks": []},
    "AGG": {"label": "iShares U.S. Aggregate Bond ETF (AGG)", "fallbacks": []},
}

_cache = {}


def fetch_json(url: str, timeout: int = 8):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (FinanzasFlow/1.0)",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_symbol_history(symbol: str, label: str):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=1y&interval=1d"
    data = fetch_json(url, timeout=8)
    result = data["chart"]["result"][0]
    closes_raw = result["indicators"]["quote"][0]["close"]
    closes = [float(c) for c in closes_raw if c is not None and c > 0]
    if len(closes) < 35:
        raise ValueError(f"Histórico insuficiente para {symbol}")

    current_price = closes[-1]
    sma_window = closes[-200:] if len(closes) >= 200 else closes
    sma200 = sum(sma_window) / len(sma_window)

    # Retorno acumulado 1 año (o del histórico disponible)
    return_1y_pct = ((current_price / closes[0]) - 1.0) * 100.0

    # Volatilidad anualizada últimos 30 días hábiles
    recent = closes[-31:]
    log_returns = [
        math.log(recent[i] / recent[i - 1])
        for i in range(1, len(recent))
        if recent[i - 1] > 0
    ]
    mean_r = sum(log_returns) / len(log_returns)
    var_r = sum((r - mean_r) ** 2 for r in log_returns) / max(1, len(log_returns) - 1)
    annual_vol_pct = math.sqrt(var_r) * math.sqrt(252) * 100.0

    low_52w = min(closes)
    high_52w = max(closes)
    range_pos = (
        (current_price - low_52w) / (high_52w - low_52w)
        if high_52w > low_52w
        else 0.5
    )

    if current_price > sma200 * 1.015:
        trend = "alcista"
    elif current_price < sma200 * 0.985:
        trend = "bajista"
    else:
        trend = "lateral"

    if annual_vol_pct < 15.0:
        volatility = "baja"
    elif annual_vol_pct > 25.0:
        volatility = "alta"
    else:
        volatility = "moderada"

    if range_pos <= 0.30:
        valuation = "barato"
    elif range_pos >= 0.80:
        valuation = "caro"
    else:
        valuation = "justo"

    return {
        "ok": True,
        "symbol": symbol,
        "label": label,
        "price": round(current_price, 2),
        "sma200": round(sma200, 2),
        "return1yPct": round(return_1y_pct, 2),
        "realizedVolPct": round(annual_vol_pct, 2),
        "range52wPct": round(range_pos * 100, 1),
        "trend": trend,
        "volatility": volatility,
        "valuation": valuation,
        "currency": result.get("meta", {}).get("currency", "USD"),
    }


def fetch_market_series(requested_symbol: str):
    clean_symbol = (requested_symbol or "ICOLCAP.CL").strip().upper()
    meta = ASSET_CATALOG.get(clean_symbol)
    candidates = [(clean_symbol, meta["label"] if meta else clean_symbol)]
    if meta:
        for fb in meta["fallbacks"]:
            fb_label = ASSET_CATALOG.get(fb, {}).get("label", fb)
            candidates.append((fb, f"{meta['label']} (vía {fb_label})"))

    last_error = None
    for sym, lbl in candidates:
        try:
            return fetch_symbol_history(sym, lbl)
        except Exception as exc:
            last_error = f"{sym}: {exc}"

    return {
        "ok": False,
        "symbol": clean_symbol,
        "label": meta["label"] if meta else clean_symbol,
        "error": last_error or "No se pudo consultar histórico del activo",
    }


def fetch_trm_colombia():
    """Consulta la TRM oficial vigente en Datos Abiertos Colombia (datos.gov.co)."""
    url = "https://www.datos.gov.co/resource/32sa-8pi3.json?$order=vigenciadesde%20DESC&$limit=1"
    try:
        rows = fetch_json(url, timeout=6)
        if rows and isinstance(rows, list):
            row = rows[0]
            return {
                "ok": True,
                "trm": round(float(row["valor"]), 2),
                "date": row.get("vigenciadesde", "")[:10],
            }
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
    return {"ok": False, "error": "Sin datos TRM"}


def build_bvc_status(requested_symbol: str):
    cache_key = (requested_symbol or "ICOLCAP.CL").strip().upper()
    now = time.time()
    cached_entry = _cache.get(cache_key)
    if cached_entry and (now - cached_entry["timestamp"] < CACHE_TTL_SECONDS):
        cached = dict(cached_entry["payload"])
        cached["cached"] = True
        return cached

    market = fetch_market_series(cache_key)
    trm_info = fetch_trm_colombia()

    risk_free_ea = 9.75
    if risk_free_ea >= 10.5:
        liquidity = "restrictiva"
    elif risk_free_ea <= 6.5:
        liquidity = "expansiva"
    else:
        liquidity = "neutral"

    payload = {
        "status": "live" if market["ok"] else "offline",
        "cached": False,
        "updatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "market": market,
        "trm": trm_info,
        "suggestedInputs": {
            "trend": market.get("trend", "lateral"),
            "volatility": market.get("volatility", "moderada"),
            "valuation": market.get("valuation", "justo"),
            "liquidity": liquidity,
            "riskFree": risk_free_ea,
        },
    }

    if market["ok"]:
        _cache[cache_key] = {"timestamp": now, "payload": payload}

    return payload


class FinanzasHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/bvc-status":
            qs = parse_qs(parsed.query)
            symbol = qs.get("symbol", ["ICOLCAP.CL"])[0]
            payload = build_bvc_status(symbol)
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return

        super().do_GET()


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), FinanzasHandler)
    print(f"FinanzasFlow escuchando en http://127.0.0.1:{PORT}")
    print("Presiona Ctrl+C para detener el servidor.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")
        server.server_close()


if __name__ == "__main__":
    main()
