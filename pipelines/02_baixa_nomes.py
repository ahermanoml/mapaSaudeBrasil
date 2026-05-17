"""
Baixa nome fantasia + razão social de todos os estabelecimentos CNES de uma UF
via API Dados Abertos da Saúde (apidadosabertos.saude.gov.br).

O CNES-ST baixado pelo pipeline 01 não traz nome — só CNES, CNPJ, CEP, capacidade.
Este script preenche essa lacuna por outra fonte (a API oficial), gravando um
cache por UF que o pipeline 03 lê pra fundir nomes ao payload final.

Uso:
    python pipelines/02_baixa_nomes.py MG
    python pipelines/02_baixa_nomes.py MG --force   # reescreve mesmo se já existir

Saída:
    data/cnes/nomes/{uf_lower}.json

Latência: a API retorna 20 por página; ~3000 páginas pra MG, sequencial, ~5min.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "cnes" / "nomes"
API = "https://apidadosabertos.saude.gov.br/cnes/estabelecimentos"
PAGE = 20  # tamanho fixo da API; valores maiores são ignorados

# IBGE 2 dígitos por UF (sigla → codigo_uf).
UF_TO_CODIGO = {
    "RO": 11, "AC": 12, "AM": 13, "RR": 14, "PA": 15, "AP": 16, "TO": 17,
    "MA": 21, "PI": 22, "CE": 23, "RN": 24, "PB": 25, "PE": 26, "AL": 27,
    "SE": 28, "BA": 29,
    "MG": 31, "ES": 32, "RJ": 33, "SP": 35,
    "PR": 41, "SC": 42, "RS": 43,
    "MS": 50, "MT": 51, "GO": 52, "DF": 53,
}


def baixar_uf(uf: str, client: httpx.Client) -> dict[str, dict]:
    codigo_uf = UF_TO_CODIGO[uf]
    out: dict[str, dict] = {}
    offset = 0
    pagina = 0
    while True:
        r = client.get(
            API,
            params={"codigo_uf": codigo_uf, "limit": PAGE, "offset": offset},
            timeout=30,
        )
        r.raise_for_status()
        rows = r.json().get("estabelecimentos", [])
        if not rows:
            break
        for e in rows:
            cnes = str(e.get("codigo_cnes") or "").zfill(7)
            if not cnes or cnes == "0000000":
                continue
            out[cnes] = {
                "nome": (e.get("nome_fantasia") or "").strip() or None,
                "razao": (e.get("nome_razao_social") or "").strip() or None,
                "codufmun": str(e.get("codigo_municipio") or "")[:6],
            }
        pagina += 1
        offset += PAGE
        if pagina % 50 == 0:
            print(f"  página {pagina} · offset {offset} · {len(out)} acumulados", file=sys.stderr)
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Baixa nomes CNES por UF")
    p.add_argument("uf", help="sigla da UF, ex.: MG")
    p.add_argument("--force", action="store_true", help="reescreve mesmo se já existir")
    args = p.parse_args(argv)

    uf = args.uf.upper()
    if uf not in UF_TO_CODIGO:
        print(f"UF desconhecida: {uf}", file=sys.stderr)
        return 2

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / f"{uf.lower()}.json"
    if out_path.exists() and not args.force:
        print(f"já existe: {out_path.relative_to(ROOT)} (use --force pra refazer)")
        return 0

    t0 = time.time()
    with httpx.Client(headers={"Accept": "application/json"}) as client:
        ests = baixar_uf(uf, client)
    elapsed = time.time() - t0

    payload = {
        "uf": uf,
        "codigo_uf": UF_TO_CODIGO[uf],
        "fonte": "apidadosabertos.saude.gov.br/cnes/estabelecimentos",
        "total": len(ests),
        "estabelecimentos": ests,
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(
        f"{uf}: {len(ests)} estabelecimentos com nome em {elapsed:.0f}s "
        f"→ {out_path.relative_to(ROOT)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
