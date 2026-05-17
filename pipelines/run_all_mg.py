"""
Re-roda o pipeline 03 pra todos os slugs MG já presentes em
public/data/enriquecido/_index.json. Usado quando o pipeline 02 (nomes) é
atualizado e os JSONs por cidade precisam ser regerados pra incorporar os nomes.

Uso:
    python pipelines/run_all_mg.py                                    # usa parquet mais recente
    python pipelines/run_all_mg.py --parquet data/cnes/cnes_st_mg_202603.parquet
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


def parquet_mais_recente() -> Path:
    candidatos = sorted(glob.glob(str(ROOT / "data" / "cnes" / "cnes_st_mg_*.parquet")))
    if not candidatos:
        raise SystemExit("nenhum parquet MG encontrado em data/cnes/")
    return Path(candidatos[-1])


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Re-roda pipeline 03 para todos slugs MG")
    p.add_argument("--parquet", help="parquet a usar (default: mais recente)")
    args = p.parse_args(argv)

    parquet = Path(args.parquet) if args.parquet else parquet_mais_recente()
    if not parquet.is_absolute():
        parquet = ROOT / parquet

    entradas = json.loads(INDEX.read_text(encoding="utf-8"))
    # Filtra só MG (códigos IBGE começando com 31).
    mg = [e for e in entradas if str(e["ibge"]).startswith("31")]
    print(f"re-rodando {len(mg)} slugs MG com {parquet.name}")

    falhas: list[str] = []
    for i, e in enumerate(mg, 1):
        print(f"[{i}/{len(mg)}] {e['slug']} (IBGE {e['ibge']})…")
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
            # Mostra só linha de "nomes encontrados" pra não poluir.
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
