"""
Baixa CNES-ST (grupo Estabelecimentos) de uma UF do mês mais recente disponível
e salva como parquet em data/cnes/cnes_st_{uf}_{aaaa}{mm}.parquet.

Uso:
    python pipelines/01_baixa_cnes.py MG
    python pipelines/01_baixa_cnes.py MG --ano 2026 --mes 2

A latência de publicação do CNES é ~2 meses; o script tenta do mês indicado
(default: corrente) pra trás até achar arquivo disponível no FTP (limite de 12
tentativas).

API: pysus 0.11 expõe a base CNES como classe; o método `download` baixa o .dbc,
converte pra .parquet localmente e devolve o caminho.
"""

from __future__ import annotations

import argparse
import datetime
import ftplib
import shutil
import sys
from pathlib import Path

import datasus_dbc
import pandas as pd
from pysus.ftp.databases.cnes import CNES

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _dbf import read_dbf  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "cnes"
DOWNLOAD_DIR = ROOT / "data" / "cnes" / ".pysus_cache"
FTP_HOST = "ftp.datasus.gov.br"


def baixar_e_ler(remote_path: str, local_dbc: Path) -> pd.DataFrame:
    """Baixa um .dbc do FTP do DataSUS, descomprime pra .dbf e parseia.

    pysus.download() faz isso internamente via dbfread, mas dbfread quebra em
    alguns CNES; usamos nosso leitor mínimo em _dbf.py.
    """
    local_dbc.parent.mkdir(parents=True, exist_ok=True)
    with ftplib.FTP(FTP_HOST) as ftp:
        ftp.login()
        with open(local_dbc, "wb") as fh:
            ftp.retrbinary(f"RETR {remote_path}", fh.write)
    local_dbf = local_dbc.with_suffix(".dbf")
    datasus_dbc.decompress(str(local_dbc), str(local_dbf))
    return read_dbf(local_dbf)


def baixar_cnes_uf(uf: str, ano_inicio: int, mes_inicio: int) -> tuple[pd.DataFrame, tuple[int, int]]:
    cnes_db = CNES().load(["ST"])
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

    y, m = ano_inicio, mes_inicio
    for _ in range(12):
        files = cnes_db.get_files("ST", uf=uf, year=y, month=m)
        if not files:
            print(f"sem arquivo no FTP — {uf}/{y}-{m:02d}, tentando mês anterior")
        else:
            f = files[0]
            print(f"baixando {f.name}…")
            local_dbc = DOWNLOAD_DIR / f"{f.name}.dbc"
            df = baixar_e_ler(f.path, local_dbc)
            print(f"OK — {uf}/{y}-{m:02d}: {len(df)} estabelecimentos")
            return df, (y, m)
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    raise RuntimeError(f"Sem dados CNES-ST pra {uf} nos últimos 12 meses")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Baixa CNES-ST por UF")
    p.add_argument("uf", help="sigla da UF, ex.: MG")
    today = datetime.date.today()
    p.add_argument("--ano", type=int, default=today.year)
    p.add_argument("--mes", type=int, default=today.month)
    p.add_argument("--manter-cache", action="store_true", help="não apaga DOWNLOAD_DIR ao final")
    args = p.parse_args(argv)

    uf = args.uf.upper()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    df, (ano, mes) = baixar_cnes_uf(uf, args.ano, args.mes)
    out = OUT_DIR / f"cnes_st_{uf.lower()}_{ano}{mes:02d}.parquet"
    df.to_parquet(out)
    print(f"salvo → {out.relative_to(ROOT)}")

    if not args.manter_cache and DOWNLOAD_DIR.exists():
        shutil.rmtree(DOWNLOAD_DIR)
    return 0


if __name__ == "__main__":
    sys.exit(main())
