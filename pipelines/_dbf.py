"""
Leitor DBF mínimo para arquivos do DataSUS — `dbfread` falha em alguns CNES
quando o terminador `\\r` do array de descritores está ausente. Usamos o
campo `header_size` do próprio header pra delimitar a região de descritores e
ignoramos o que vier além do limite indicado pelo número total de records.

Suporta tipos 'C' (caractere) e 'N' (numérico) — basta pra CNES-ST.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from pathlib import Path

import pandas as pd


@dataclass
class Field:
    name: str
    type: str
    length: int
    offset: int  # offset relativo dentro do record


def _parse_fields(buf: bytes) -> list[Field]:
    fields: list[Field] = []
    offset = 1  # primeiro byte do record é flag de exclusão
    pos = 0
    while pos + 32 <= len(buf):
        chunk = buf[pos : pos + 32]
        if chunk[0] in (0x0D, 0x00):
            break
        name = chunk[:11].rstrip(b"\x00").decode("ascii", "replace").strip()
        ftype = chr(chunk[11])
        flen = chunk[16]
        if not name or ftype not in "CNDLF":
            break
        fields.append(Field(name=name, type=ftype, length=flen, offset=offset))
        offset += flen
        pos += 32
    return fields


def read_dbf(path: str | Path, encoding: str = "iso-8859-1") -> pd.DataFrame:
    p = Path(path)
    with open(p, "rb") as fh:
        header = fh.read(32)
        nrec = int.from_bytes(header[4:8], "little")
        hdr_size = int.from_bytes(header[8:10], "little")
        rec_size = int.from_bytes(header[10:12], "little")

        field_buf = fh.read(hdr_size - 32)
        fields = _parse_fields(field_buf)
        if not fields:
            raise RuntimeError(f"sem campos parseáveis em {p}")

        fh.seek(hdr_size)
        data = fh.read(nrec * rec_size)

    if len(data) < nrec * rec_size:
        nrec = len(data) // rec_size

    cols: dict[str, list] = {f.name: [None] * nrec for f in fields}
    for i in range(nrec):
        rec = data[i * rec_size : (i + 1) * rec_size]
        if rec[:1] == b"*":  # deletado
            for f in fields:
                cols[f.name][i] = None
            continue
        for f in fields:
            raw = rec[f.offset : f.offset + f.length]
            val = raw.decode(encoding, "replace").strip()
            if f.type == "N":
                if val == "":
                    cols[f.name][i] = None
                else:
                    try:
                        cols[f.name][i] = int(val) if "." not in val else float(val)
                    except ValueError:
                        cols[f.name][i] = None
            else:
                cols[f.name][i] = val

    return pd.DataFrame(cols)
