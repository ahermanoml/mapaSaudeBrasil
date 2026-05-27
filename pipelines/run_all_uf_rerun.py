"""
Re-roda o pipeline 03 pra todos os slugs de uma UF já presentes em
public/data/enriquecido/_index.json. Usado quando o pipeline 02 (nomes) é
atualizado e os JSONs por cidade precisam ser regerados pra incorporar os nomes.

Uso:
    python pipelines/run_all_uf_rerun.py --uf MG
    python pipelines/run_all_uf_rerun.py --uf GO --parquet data/cnes/cnes_st_go_202604.parquet
"""

from __future__ import annotations

import argparse
import glob
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "public" / "data" / "enriquecido" / "_index.json"
MUNICIPIOS_JSON = ROOT / "src" / "data" / "municipios.json"


def parquet_mais_recente(uf: str) -> Path:
    pattern = str(ROOT / "data" / "cnes" / f"cnes_st_{uf.lower()}_*.parquet")
    candidatos = sorted(glob.glob(pattern))
    if not candidatos:
        raise SystemExit(f"nenhum parquet {uf} encontrado em data/cnes/")
    return Path(candidatos[-1])


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Re-roda pipeline 03 para todos slugs de uma UF")
    p.add_argument("--uf", required=True, help="sigla da UF, ex.: MG, GO, SP")
    p.add_argument("--parquet", help="parquet a usar (default: mais recente da UF)")
    args = p.parse_args(argv)

    uf = args.uf.upper()
    parquet = Path(args.parquet) if args.parquet else parquet_mais_recente(uf)
    if not parquet.is_absolute():
        parquet = ROOT / parquet

    municipios = json.loads(MUNICIPIOS_JSON.read_text(encoding="utf-8"))
    ibges_uf = {m["id"] for m in municipios if m["uf"] == uf}

    entradas = json.loads(INDEX.read_text(encoding="utf-8"))
    alvo = [e for e in entradas if e["ibge"] in ibges_uf]
    print(f"re-rodando {len(alvo)} slugs {uf} com {parquet.name}")

    falhas: list[str] = []
    for i, e in enumerate(alvo, 1):
        print(f"[{i}/{len(alvo)}] {e['slug']} (IBGE {e['ibge']})…")
        r = subprocess.run(
            [
                sys.executable,
                str(ROOT / "pipelines" / "03_filtra_generalista.py"),
                "--parquet", str(parquet),
                "--ibge", str(e["ibge"]),
                "--slug", e["slug"],
            ],
            capture_output=True,
            text=True,
        )
        if r.returncode != 0:
            falhas.append(e["slug"])
            print(f"  FALHOU: {r.stderr.strip()}", file=sys.stderr)
        else:
            for line in r.stderr.splitlines():
                if "nomes encontrados" in line:
                    print(f"  {line.strip()}")
                    break

    if falhas:
        print(f"\n{len(falhas)} falhas: {', '.join(falhas)}", file=sys.stderr)
        return 1
    print("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
