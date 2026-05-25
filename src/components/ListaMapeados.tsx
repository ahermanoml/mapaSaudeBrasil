import { useEffect, useMemo, useState } from 'react'
import { MUNICIPIOS_BY_ID } from '../data/municipios'
import { STATES_BY_SIGLA } from '../data/states'
import {
  fetchEstabelecimentos,
  type EstabelecimentosPayload,
  type Estabelecimento,
} from '../data/cnes'
import type { View } from '../types'

interface ManifestRow {
  ibge: number
  slug: string
}

interface ColetadasFile {
  nome_meso?: string
  queue: Array<{ ibge: number }>
}

interface UFGroup {
  uf: string
  nome: string
  cidades: Array<{ ibge: number; nome: string; slug: string }>
}

export function ListaMapeados({
  onNavigate,
}: {
  onNavigate: (v: View) => void
}) {
  const [groups, setGroups] = useState<UFGroup[] | null>(null)
  const [meso, setMeso] = useState<string | null>(null)
  const [erro, setErro] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch(`${import.meta.env.BASE_URL}data/enriquecido/_index.json`).then(
        (r) => (r.ok ? (r.json() as Promise<ManifestRow[]>) : [])
      ),
      fetch(`${import.meta.env.BASE_URL}data/coletadas.json`).then((r) =>
        r.ok ? (r.json() as Promise<ColetadasFile>) : { queue: [] }
      ),
    ])
      .then(([rows, coletadas]) => {
        if (cancelled) return
        const allow = new Set(coletadas.queue.map((q) => q.ibge))
        const filtered = rows.filter((r) => allow.has(r.ibge))
        setGroups(groupByUF(filtered))
        setMeso(coletadas.nome_meso ?? null)
      })
      .catch(() => {
        if (!cancelled) setErro(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const totalMun = groups?.reduce((s, g) => s + g.cidades.length, 0) ?? 0

  return (
    <div className="max-w-3xl">
      <header className="mb-8">
        <div className="num text-[10px] tracking-[0.3em] uppercase text-ink-50">
          inventário · CNES
        </div>
        <h2
          className="font-display italic text-6xl leading-[0.9] mt-1 text-ink"
          style={{ fontVariationSettings: '"opsz" 144, "SOFT" 80' }}
        >
          Municípios mapeados
        </h2>
        {groups && (
          <div className="num text-[11px] mt-3 text-ink-50 flex gap-4 flex-wrap">
            <span>
              <span className="text-ink">{totalMun.toLocaleString('pt-BR')}</span>{' '}
              municípios coletados
            </span>
            {meso && (
              <>
                <span>·</span>
                <span>{meso}</span>
              </>
            )}
          </div>
        )}
      </header>

      {erro && (
        <p className="text-ink-70 italic font-display">
          Não foi possível carregar o índice.
        </p>
      )}

      {!groups && !erro && (
        <p className="num text-[10px] tracking-[0.22em] uppercase text-ink-50">
          carregando…
        </p>
      )}

      {groups && (
        <ul className="flex flex-col gap-2">
          {groups.map((g) => (
            <UFNode key={g.uf} group={g} onNavigate={onNavigate} />
          ))}
        </ul>
      )}
    </div>
  )
}

function UFNode({
  group,
  onNavigate,
}: {
  group: UFGroup
  onNavigate: (v: View) => void
}) {
  return (
    <li className="hairline bg-paper-warm/60 rounded-sm">
      <details className="group">
        <summary className="cursor-pointer select-none list-none px-4 py-3 flex items-baseline gap-3 hover:bg-paper transition-colors">
          <Chevron />
          <span className="num text-[10px] tracking-[0.22em] uppercase text-ink-50 w-8">
            {group.uf}
          </span>
          <span
            className="font-display text-xl flex-1"
            style={{ fontVariationSettings: '"opsz" 24' }}
          >
            {group.nome}
          </span>
          <span className="num text-[10px] text-ink-50 tabular-nums">
            {group.cidades.length.toLocaleString('pt-BR')} mun.
          </span>
        </summary>
        <ul className="pl-8 pr-2 pb-2 flex flex-col gap-1">
          {group.cidades.map((c) => (
            <CityNode key={c.ibge} cidade={c} onNavigate={onNavigate} />
          ))}
        </ul>
      </details>
    </li>
  )
}

function CityNode({
  cidade,
  onNavigate,
}: {
  cidade: { ibge: number; nome: string; slug: string }
  onNavigate: (v: View) => void
}) {
  const [opened, setOpened] = useState(false)
  const [payload, setPayload] = useState<EstabelecimentosPayload | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!opened || payload || loading) return
    setLoading(true)
    fetchEstabelecimentos(cidade.ibge)
      .then((p) => setPayload(p))
      .finally(() => setLoading(false))
  }, [opened, cidade.ibge, payload, loading])

  const m = MUNICIPIOS_BY_ID[cidade.ibge]

  return (
    <li className="border-l border-ink-15/60">
      <details
        className="group"
        onToggle={(e) => setOpened((e.target as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer select-none list-none pl-3 pr-2 py-1.5 flex items-baseline gap-2 hover:bg-paper transition-colors">
          <Chevron small />
          <span
            className="font-display text-base flex-1"
            style={{ fontVariationSettings: '"opsz" 18' }}
          >
            {cidade.nome}
          </span>
          {payload && (
            <span className="num text-[10px] text-ink-50 tabular-nums">
              {payload.total_relevante_generalista.toLocaleString('pt-BR')} rel.
            </span>
          )}
          {m && (
            <button
              type="button"
              onClick={(ev) => {
                ev.preventDefault()
                ev.stopPropagation()
                onNavigate({ kind: 'cidade', uf: m.uf, municipioId: m.id })
              }}
              className="num text-[9px] tracking-[0.22em] uppercase text-ink-50 hover:text-ink underline-offset-2 hover:underline"
              title="abrir no mapa"
            >
              mapa ↗
            </button>
          )}
        </summary>
        <div className="pl-6 pr-2 pb-2 pt-1">
          {loading && (
            <p className="num text-[10px] tracking-[0.22em] uppercase text-ink-50">
              carregando…
            </p>
          )}
          {!loading && opened && !payload && (
            <p className="text-ink-50 text-sm italic font-display">
              Sem dados CNES para este município.
            </p>
          )}
          {payload && <ServicosToggles payload={payload} />}
        </div>
      </details>
    </li>
  )
}

function ServicosToggles({ payload }: { payload: EstabelecimentosPayload }) {
  const grupos = useMemo(() => groupByTipo(payload.estabelecimentos), [payload])

  return (
    <ul className="flex flex-col gap-1">
      {grupos.map((g) => (
        <li key={g.tipo} className="border-l border-ink-15/60">
          <details className="group">
            <summary className="cursor-pointer select-none list-none pl-3 pr-2 py-1 flex items-baseline gap-2 hover:bg-paper transition-colors">
              <Chevron small />
              <span
                className="font-display text-sm flex-1"
                style={{ fontVariationSettings: '"opsz" 14' }}
              >
                {g.tipo}
              </span>
              <span className="num text-[10px] text-ink-50 tabular-nums">
                {g.itens.length.toLocaleString('pt-BR')}
              </span>
            </summary>
            <ul className="pl-6 pr-2 py-1 divide-y divide-ink-15/40">
              {g.itens.map((e) => (
                <li
                  key={e.cnes}
                  className="py-1 flex items-baseline gap-2 text-sm"
                  title={e.cnes}
                >
                  <span className="num text-[9px] text-ink-30 tabular-nums w-14 shrink-0">
                    {e.cnes}
                  </span>
                  <span className="flex-1 min-w-0 text-ink truncate">
                    {e.nome ?? '—'}
                  </span>
                  {(e.atende_sus === 'S' || e.atende_sus === '1') && (
                    <span
                      className="num text-[9px] tracking-[0.18em] uppercase shrink-0"
                      style={{ color: 'var(--verde-600, #4a6b3a)' }}
                    >
                      sus
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        </li>
      ))}
    </ul>
  )
}

function Chevron({ small = false }: { small?: boolean }) {
  return (
    <span
      aria-hidden
      className={
        'inline-block text-ink-50 transition-transform group-open:rotate-90 ' +
        (small ? 'text-[8px] w-2' : 'text-[10px] w-3')
      }
    >
      ▶
    </span>
  )
}

function groupByUF(rows: ManifestRow[]): UFGroup[] {
  const byUF = new Map<string, UFGroup>()
  for (const r of rows) {
    const m = MUNICIPIOS_BY_ID[r.ibge]
    if (!m) continue
    let g = byUF.get(m.uf)
    if (!g) {
      const ufNome = STATES_BY_SIGLA[m.uf]?.properties.nome ?? m.uf
      g = { uf: m.uf, nome: ufNome, cidades: [] }
      byUF.set(m.uf, g)
    }
    g.cidades.push({ ibge: r.ibge, nome: m.nome, slug: r.slug })
  }
  for (const g of byUF.values()) {
    g.cidades.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }
  return Array.from(byUF.values()).sort((a, b) =>
    a.nome.localeCompare(b.nome, 'pt-BR')
  )
}

interface TipoGroup {
  tipo: string
  itens: Estabelecimento[]
}

function groupByTipo(items: Estabelecimento[]): TipoGroup[] {
  const map = new Map<string, Estabelecimento[]>()
  for (const e of items) {
    const k = e.tp_unid || 'Outros'
    const arr = map.get(k) ?? []
    arr.push(e)
    map.set(k, arr)
  }
  return Array.from(map.entries())
    .map(([tipo, itens]) => ({
      tipo,
      itens: itens.sort((a, b) =>
        (a.nome ?? '').localeCompare(b.nome ?? '', 'pt-BR')
      ),
    }))
    .sort((a, b) => b.itens.length - a.itens.length)
}
