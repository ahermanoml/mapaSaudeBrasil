"""
Constrói municipios/triangulo_queue.json: lista ordenada dos municípios da
meso-região 'Triângulo Mineiro e Alto Paranaíba' (IBGE 3107), do mais próximo
ao mais distante de Uberlândia.

Fontes:
- https://servicodados.ibge.gov.br/api/v1/localidades/mesorregioes/{id}/municipios
- https://servicodados.ibge.gov.br/api/v3/malhas/estados/MG (geojson, qualidade=baixa)

Distância usa o centro do bounding box de cada município — suficiente pra
ordenar; não estamos publicando isso, só usando pra escalonar processamento.
"""

from __future__ import annotations

import gzip
import json
import math
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
QUEUE_PATH = ROOT / "municipios" / "triangulo_queue.json"
MESO_ID = 3105  # Triângulo Mineiro e Alto Paranaíba (IBGE)
UBERLANDIA_IBGE = 3170206


def slugify(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "_", s.lower()).strip("_")
    return s


def fetch_json(url: str, timeout: float = 60.0):
    req = urllib.request.Request(
        url, headers={"Accept-Encoding": "gzip", "User-Agent": "mapaSaudeBrasil/0.1"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            raw = gzip.decompress(raw)
        return json.loads(raw.decode("utf-8"))


def bbox_center(geometry) -> tuple[float, float] | None:
    coords: list[list[float]] = []

    def walk(g):
        t = g["type"]
        if t == "Polygon":
            for ring in g["coordinates"]:
                coords.extend(ring)
        elif t == "MultiPolygon":
            for poly in g["coordinates"]:
                for ring in poly:
                    coords.extend(ring)
        elif t == "GeometryCollection":
            for sub in g["geometries"]:
                walk(sub)

    walk(geometry)
    if not coords:
        return None
    xs = [c[0] for c in coords]
    ys = [c[1] for c in coords]
    return ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2)


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lon1, lat1 = a
    lon2, lat2 = b
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    h = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    )
    return 2 * R * math.asin(math.sqrt(h))


def main() -> int:
    print(f"buscando municípios da meso-região {MESO_ID}…")
    municipios = fetch_json(
        f"https://servicodados.ibge.gov.br/api/v1/localidades/mesorregioes/{MESO_ID}/municipios"
    )
    print(f"  {len(municipios)} cidades na meso-região")

    print("baixando malha MG (qualidade mínima, intra-regiao=municipio)…")
    # `application/vnd.geo+json` precisa entrar literal — IBGE rejeita o `+` url-encoded.
    malha = fetch_json(
        "https://servicodados.ibge.gov.br/api/v3/malhas/estados/MG"
        "?qualidade=minima&formato=application/vnd.geo+json&intrarregiao=municipio"
    )

    centroides_por_ibge: dict[int, tuple[float, float]] = {}
    for feat in malha["features"]:
        ibge = int(feat["properties"]["codarea"])
        c = bbox_center(feat["geometry"])
        if c:
            centroides_por_ibge[ibge] = c

    uberlandia_c = centroides_por_ibge.get(UBERLANDIA_IBGE)
    if not uberlandia_c:
        raise RuntimeError("Centroide de Uberlândia não encontrado na malha MG")

    rows: list[dict] = []
    for m in municipios:
        ibge = m["id"]
        nome = m["nome"]
        c = centroides_por_ibge.get(ibge)
        if c is None:
            print(f"  WARN: sem centroide para {nome} ({ibge})", file=sys.stderr)
            continue
        dist = haversine_km(uberlandia_c, c)
        rows.append(
            {
                "ibge": ibge,
                "nome": nome,
                "slug": slugify(nome),
                "dist_km": round(dist, 1),
            }
        )

    rows.sort(key=lambda r: r["dist_km"])

    QUEUE_PATH.parent.mkdir(parents=True, exist_ok=True)
    QUEUE_PATH.write_text(
        json.dumps(
            {
                "meso_id": MESO_ID,
                "nome_meso": "Triângulo Mineiro e Alto Paranaíba",
                "origem": "Uberlândia (IBGE 3170206)",
                "total": len(rows),
                "queue": rows,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"salvo → {QUEUE_PATH.relative_to(ROOT)} ({len(rows)} cidades)")

    print("\nprimeiras 10 do queue:")
    for r in rows[:10]:
        print(f"  {r['dist_km']:6.1f} km  {r['ibge']}  {r['slug']:35s} {r['nome']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
