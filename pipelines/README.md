# Pipelines

Mini-pipeline de dados para o mapa de saúde. Tudo é Python puro, rodado sob
demanda (sem orquestrador) e idempotente — cada script grava arquivos
versionados por mês/UF em `../data/`.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r pipelines/requirements.txt
```

> O Python 3.14 do sistema é `EXTERNALLY-MANAGED`. Sempre use o venv.

## Etapas

| # | Script | Saída | Status |
|---|---|---|---|
| 01 | `01_baixa_cnes.py UF` | `data/cnes/cnes_st_{uf}_{aaaa}{mm}.parquet` | pronto |
| 02 | _scraping ficha CNES (nome + coordenadas)_ | a definir | TODO |
| 03 | `03_filtra_generalista.py --parquet ... --ibge ... --slug ...` | `data/enriquecido/{slug}.json` | pronto |
| 04 | _subagente delta (medicina ocupacional, telemed, operadoras PJ)_ | `data/delta/{slug}.json` | TODO |

### Exemplo — Uberlândia (MG, IBGE 3170206)

```bash
python pipelines/01_baixa_cnes.py MG                                       # → data/cnes/cnes_st_mg_202602.parquet
python pipelines/03_filtra_generalista.py \
    --parquet data/cnes/cnes_st_mg_202602.parquet \
    --ibge 3170206 \
    --slug uberlandia                                                      # → data/enriquecido/uberlandia.json
```

### Batch — todos municípios de uma UF

```bash
python pipelines/01_baixa_cnes.py GO                                       # → data/cnes/cnes_st_go_{aaaa}{mm}.parquet
python pipelines/run_all_uf.py --uf GO                                     # processa os 246 municípios de GO
python pipelines/run_all_uf_rerun.py --uf GO                               # re-roda após pipeline 02 atualizar nomes
```

`run_all_uf.py` faz merge com o `_index.json` existente, então rodar para uma
nova UF preserva as entradas das UFs já processadas.

## Convenções

- IDs de município **no frontend** = IBGE 7 dígitos (com DV). No CNES =
  `CODUFMUN` 6 dígitos (sem DV). O pipeline 03 trunca automaticamente.
- Cada arquivo em `data/enriquecido/{slug}.json` é consumido por
  `src/data/cnes.ts` no frontend. Manter o nome do slug igual ao nome usado lá.
