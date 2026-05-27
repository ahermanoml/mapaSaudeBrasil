"""
Processa todos os municípios de uma UF em uma única passada:

- Carrega o parquet CNES-ST mais recente da UF uma vez só.
- Carrega o cache de nomes (pipeline 02) da UF uma vez só.
- Itera src/data/municipios.json filtrando pela UF e gera os JSONs em
  data/enriquecido/ + public/data/enriquecido/.
- Atualiza public/data/enriquecido/_index.json no fim (uma única gravação),
  fundindo com entradas existentes de outras UFs.

Reaproveita as funções de pipelines/03_filtra_generalista.py.

Uso:
    .venv/bin/python pipelines/run_all_uf.py --uf MG
    .venv/bin/python pipelines/run_all_uf.py --uf GO
    .venv/bin/python pipelines/run_all_uf.py --uf GO --parquet data/cnes/cnes_st_go_202604.parquet
    .venv/bin/python pipelines/run_all_uf.py --uf MG --limit 20         # smoke test
"""

from __future__ import annotations

import argparse
import glob
import importlib
import json
import re
import sys
import time
import unicodedata
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
MUNICIPIOS_JSON = ROOT / "src" / "data" / "municipios.json"

sys.path.insert(0, str(ROOT / "pipelines"))
pipe03 = importlib.import_module("03_filtra_generalista")


def slugify(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "_", s.lower()).strip("_")
    return s


def parquet_mais_recente(uf: str) -> Path:
    pattern = str(ROOT / "data" / "cnes" / f"cnes_st_{uf.lower()}_*.parquet")
    candidatos = sorted(glob.glob(pattern))
    if not candidatos:
        raise SystemExit(f"nenhum parquet {uf} encontrado em data/cnes/")
    return Path(candidatos[-1])


def _exporta_sem_index(
    df_mun: pd.DataFrame,
    ibge7: int,
    slug: str,
    fonte: str,
    nomes: dict,
) -> tuple[int, int]:
    """Versão de pipe03.exportar que não toca no _index.json (escrito uma vez no fim)."""
    pipe03.OUT_DIR.mkdir(parents=True, exist_ok=True)
    pipe03.PUBLIC_OUT_DIR.mkdir(parents=True, exist_ok=True)

    relevantes = df_mun[df_mun["RELEVANTE_GENERALISTA"]].copy()
    cols_present = [c for c in pipe03.EXPORT_COLS if c in relevantes.columns]
    saida = relevantes[cols_present].rename(
        columns={c: pipe03.EXPORT_COLS[c] for c in cols_present}
    )

    if nomes and "cnes" in saida.columns:
        saida["cnes"] = saida["cnes"].astype(str).str.zfill(7)
        saida["nome"] = saida["cnes"].map(
            lambda c: (nomes.get(c, {}).get("nome") or nomes.get(c, {}).get("razao"))
        )

    contagem = (
        relevantes.groupby("TP_UNID_DESC").size().sort_values(ascending=False).to_dict()
    )

    payload = {
        "ibge": ibge7,
        "codufmun": pipe03.ibge7_to_codufmun(ibge7),
        "fonte": fonte,
        "total_no_municipio": int(len(df_mun)),
        "total_relevante_generalista": int(len(relevantes)),
        "por_tipo": contagem,
        "estabelecimentos": json.loads(
            saida.to_json(orient="records", force_ascii=False)
        ),
    }

    (pipe03.OUT_DIR / f"{slug}.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (pipe03.PUBLIC_OUT_DIR / f"{slug}.json").write_text(
        json.dumps(payload, ensure_ascii=False), encoding="utf-8"
    )
    return int(len(df_mun)), int(len(relevantes))


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Processa todos os municípios de uma UF em batch")
    p.add_argument("--uf", required=True, help="sigla da UF, ex.: MG, GO, SP")
    p.add_argument("--parquet", help="parquet a usar (default: mais recente da UF)")
    p.add_argument("--limit", type=int, help="processa apenas N municípios (smoke test)")
    args = p.parse_args(argv)

    uf = args.uf.upper()
    parquet = Path(args.parquet) if args.parquet else parquet_mais_recente(uf)
    if not parquet.is_absolute():
        parquet = ROOT / parquet

    print(f"carregando parquet: {parquet.name}")
    t0 = time.time()
    df = pd.read_parquet(parquet)
    df["CODUFMUN"] = df["CODUFMUN"].astype(str)
    df["TP_UNID"] = df["TP_UNID"].astype(str).str.zfill(2)
    df["TP_UNID_DESC"] = df["TP_UNID"].map(pipe03.TP_UNID).fillna("Outro")
    df["RELEVANTE_GENERALISTA"] = df["TP_UNID"].isin(pipe03.TIPOS_GENERALISTA)
    print(f"  {len(df)} linhas em {time.time()-t0:.1f}s")

    print(f"carregando cache de nomes ({uf})…")
    nomes = pipe03._carregar_nomes(uf)
    print(f"  {len(nomes)} estabelecimentos no cache")

    municipios = json.loads(MUNICIPIOS_JSON.read_text(encoding="utf-8"))
    alvo = [m for m in municipios if m["uf"] == uf]
    if args.limit:
        alvo = alvo[: args.limit]
    print(f"processando {len(alvo)} municípios de {uf}")

    novas_entradas: list[dict] = []
    falhas: list[str] = []
    sem_dados: list[str] = []
    t_loop = time.time()
    for i, m in enumerate(alvo, 1):
        ibge7 = m["id"]
        nome = m["nome"]
        slug = slugify(nome)
        codufmun = pipe03.ibge7_to_codufmun(ibge7)
        df_mun = df[df["CODUFMUN"] == codufmun].copy()
        try:
            total, rel = _exporta_sem_index(df_mun, ibge7, slug, parquet.name, nomes)
        except Exception as e:
            falhas.append(f"{slug} ({ibge7}): {e}")
            print(f"  [{i}/{len(alvo)}] FALHA {slug}: {e}", file=sys.stderr)
            continue
        if total == 0:
            sem_dados.append(slug)
        novas_entradas.append({"ibge": ibge7, "slug": slug})
        if i % 50 == 0 or i == len(alvo):
            elapsed = time.time() - t_loop
            taxa = i / elapsed if elapsed else 0
            print(f"  [{i}/{len(alvo)}] {nome:30s} total={total} rel={rel} ({taxa:.1f}/s)")

    pipe03.INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    if pipe03.INDEX_PATH.exists():
        existentes = json.loads(pipe03.INDEX_PATH.read_text(encoding="utf-8"))
    else:
        existentes = []
    novos_ibges = {e["ibge"] for e in novas_entradas}
    merged = [e for e in existentes if e.get("ibge") not in novos_ibges] + novas_entradas
    merged.sort(key=lambda r: r["ibge"])
    pipe03.INDEX_PATH.write_text(
        json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\nindex atualizado → {pipe03.INDEX_PATH.relative_to(ROOT)} "
          f"({len(merged)} entradas totais, {len(novas_entradas)} desta rodada)")

    if sem_dados:
        print(f"AVISO: {len(sem_dados)} municípios sem nenhuma linha no parquet "
              f"(arquivo gerado vazio): {', '.join(sem_dados[:10])}"
              f"{'…' if len(sem_dados) > 10 else ''}")
    if falhas:
        print(f"\n{len(falhas)} falhas:", file=sys.stderr)
        for f in falhas:
            print(f"  {f}", file=sys.stderr)
        return 1
    print(f"\nok em {time.time()-t0:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
