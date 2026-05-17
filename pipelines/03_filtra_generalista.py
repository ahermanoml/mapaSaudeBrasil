"""
Filtra um parquet CNES-ST por município, classifica TP_UNID e exporta um JSON
"estrutural". Se houver cache de nomes (pipeline 02) pra UF correspondente, funde
o nome fantasia / razão social ao payload.

Uso:
    python pipelines/03_filtra_generalista.py \\
        --parquet data/cnes/cnes_st_mg_202602.parquet \\
        --ibge 3170206 \\
        --slug uberlandia

`--ibge` aceita o código IBGE de 7 dígitos (padrão do frontend); o script trunca
o último dígito para casar com CODUFMUN do CNES (6 dígitos).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "data" / "enriquecido"
PUBLIC_OUT_DIR = ROOT / "public" / "data" / "enriquecido"
NOMES_DIR = ROOT / "data" / "cnes" / "nomes"
INDEX_PATH = PUBLIC_OUT_DIR / "_index.json"

# Subset relevante de tb_tipo_unidade do CNES.
TP_UNID = {
    "01": "Posto de Saúde",
    "02": "Centro de Saúde / UBS",
    "04": "Policlínica",
    "05": "Hospital Geral",
    "07": "Hospital Especializado",
    "15": "Unidade Mista",
    "20": "Pronto Socorro Geral",
    "21": "Pronto Socorro Especializado",
    "22": "Consultório Isolado",
    "32": "Unidade Móvel Pré-Hospitalar - Urgência",
    "36": "Clínica/Centro de Especialidade",
    "39": "Unidade de Apoio Diagnose e Terapia (SADT)",
    "40": "Unidade Móvel Terrestre",
    "43": "Farmácia",
    "50": "Unidade de Vigilância em Saúde",
    "62": "Hospital/Dia - Isolado",
    "70": "Centro de Atenção Psicossocial (CAPS)",
    "71": "Centro de Apoio à Saúde da Família",
    "73": "Pronto Atendimento",
    "75": "Telessaúde",
    "77": "Serviço de Atenção Domiciliar Isolado (Home Care)",
}

# Tipos onde generalista tipicamente trabalha.
TIPOS_GENERALISTA = {
    "01", "02", "04", "05", "07", "15",   # atenção básica + hospitais
    "20", "21", "32", "73",                # urgência/emergência
    "22", "36",                            # consultório isolado / clínica esp.
}

EXPORT_COLS = {
    "CNES": "cnes",
    "TP_UNID": "tp_unid_cod",
    "TP_UNID_DESC": "tp_unid",
    "CPF_CNPJ": "cnpj",
    "CNPJ_MAN": "cnpj_mantenedora",
    "COD_CEP": "cep",
    "VINC_SUS": "atende_sus",
    "ATENDAMB": "atendimento_ambulatorial",
    "ATENDHOS": "atendimento_hospitalar",
    "URGEMERG": "urgencia_emergencia",
    "NAT_JUR": "natureza_juridica",
}


def ibge7_to_codufmun(ibge7: int) -> str:
    s = str(ibge7).rjust(7, "0")
    return s[:6]


def filtrar_municipio(df: pd.DataFrame, codufmun: str) -> pd.DataFrame:
    out = df[df["CODUFMUN"].astype(str) == codufmun].copy()
    out["TP_UNID"] = out["TP_UNID"].astype(str).str.zfill(2)
    out["TP_UNID_DESC"] = out["TP_UNID"].map(TP_UNID).fillna("Outro")
    out["RELEVANTE_GENERALISTA"] = out["TP_UNID"].isin(TIPOS_GENERALISTA)
    return out


def _carregar_nomes(uf: str) -> dict[str, dict]:
    """Lê data/cnes/nomes/{uf}.json (cache do pipeline 02). Vazio se não existir."""
    p = NOMES_DIR / f"{uf.lower()}.json"
    if not p.exists():
        return {}
    payload = json.loads(p.read_text(encoding="utf-8"))
    return payload.get("estabelecimentos", {})


def exportar(df: pd.DataFrame, ibge7: int, slug: str, fonte: str, uf: str | None) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    PUBLIC_OUT_DIR.mkdir(parents=True, exist_ok=True)

    relevantes = df[df["RELEVANTE_GENERALISTA"]].copy()
    cols_present = [c for c in EXPORT_COLS if c in relevantes.columns]
    saida = relevantes[cols_present].rename(columns={c: EXPORT_COLS[c] for c in cols_present})

    nomes = _carregar_nomes(uf) if uf else {}
    if nomes:
        saida["cnes"] = saida["cnes"].astype(str).str.zfill(7)
        saida["nome"] = saida["cnes"].map(
            lambda c: (nomes.get(c, {}).get("nome") or nomes.get(c, {}).get("razao"))
        )
        com_nome = int(saida["nome"].notna().sum())
        print(f"  nomes encontrados: {com_nome}/{len(saida)}", file=sys.stderr)

    contagem = (
        relevantes.groupby("TP_UNID_DESC").size().sort_values(ascending=False).to_dict()
    )

    payload = {
        "ibge": ibge7,
        "codufmun": ibge7_to_codufmun(ibge7),
        "fonte": fonte,
        "total_no_municipio": int(len(df)),
        "total_relevante_generalista": int(len(relevantes)),
        "por_tipo": contagem,
        "estabelecimentos": json.loads(
            saida.to_json(orient="records", force_ascii=False)
        ),
    }

    out = OUT_DIR / f"{slug}.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    # Espelha no public/ pro frontend servir via fetch.
    (PUBLIC_OUT_DIR / f"{slug}.json").write_text(
        json.dumps(payload, ensure_ascii=False), encoding="utf-8"
    )
    _atualiza_index(ibge7, slug)
    return out


def _atualiza_index(ibge7: int, slug: str) -> None:
    """Mantém public/data/enriquecido/_index.json com a lista de cidades disponíveis.

    Formato: [{"ibge": 3170206, "slug": "uberlandia"}, ...]
    Idempotente: se o ibge já existir, atualiza o slug; senão, append.
    """
    if INDEX_PATH.exists():
        idx = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    else:
        idx = []
    # remove entrada anterior do mesmo ibge (se houver), depois adiciona
    idx = [r for r in idx if r.get("ibge") != ibge7]
    idx.append({"ibge": ibge7, "slug": slug})
    idx.sort(key=lambda r: r["ibge"])
    INDEX_PATH.write_text(
        json.dumps(idx, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Filtra CNES-ST por município e exporta JSON")
    p.add_argument("--parquet", required=True, help="parquet gerado pelo pipeline 01")
    p.add_argument("--ibge", required=True, type=int, help="código IBGE 7 dígitos")
    p.add_argument("--slug", required=True, help="nome do arquivo de saída sem extensão")
    args = p.parse_args(argv)

    parquet_path = Path(args.parquet)
    if not parquet_path.is_absolute():
        parquet_path = ROOT / parquet_path
    df = pd.read_parquet(parquet_path)

    # Infere UF do nome do arquivo: cnes_st_{uf}_{aaaammm}.parquet
    uf = None
    parts = parquet_path.stem.split("_")
    if len(parts) >= 3 and parts[0] == "cnes" and parts[1] == "st":
        uf = parts[2].upper()

    codufmun = ibge7_to_codufmun(args.ibge)
    filtrado = filtrar_municipio(df, codufmun)
    if filtrado.empty:
        print(f"AVISO — nenhum estabelecimento com CODUFMUN={codufmun}", file=sys.stderr)

    out = exportar(filtrado, args.ibge, args.slug, parquet_path.name, uf)
    relevantes = int(filtrado["RELEVANTE_GENERALISTA"].sum())
    print(
        f"{args.slug}: {len(filtrado)} total, {relevantes} relevantes pra GP "
        f"→ {out.relative_to(ROOT)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
