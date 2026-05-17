import { motion, AnimatePresence } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import type { View, RegionId, Municipio } from '../types'
import { REGIONS, REGION_ORDER } from '../data/regions'
import { STATES_BY_SIGLA, STATES_GEO } from '../data/states'
import { MUNICIPIOS_BY_UF, MUNICIPIOS_BY_ID } from '../data/municipios'
import {
  fetchEstabelecimentos,
  type Estabelecimento,
  type EstabelecimentosPayload,
} from '../data/cnes'

interface SidePanelProps {
  view: View
  hoveredRegion: RegionId | null
  hoveredUF: string | null
  hoveredMun: number | null
  onSelectRegion: (r: RegionId) => void
  onSelectUF: (uf: string) => void
  onSelectMun: (id: number) => void
  onHoverRegion: (r: RegionId | null) => void
  onHoverUF: (uf: string | null) => void
}

export function SidePanel(props: SidePanelProps) {
  const { view } = props

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={panelKey(view)}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.4 }}
        className="flex flex-col gap-6"
      >
        {view.kind === 'brasil' && <BrasilPanel {...props} />}
        {view.kind === 'regiao' && <RegiaoPanel {...props} regiao={view.regiao} />}
        {view.kind === 'cidade' && (
          <CidadePanel municipioId={view.municipioId} />
        )}
        {(view.kind === 'estado' || view.kind === 'cidade') && (
          <EstadoPanel
            {...props}
            uf={view.uf}
            collapsed={view.kind === 'cidade'}
          />
        )}
      </motion.div>
    </AnimatePresence>
  )
}

function panelKey(view: View): string {
  if (view.kind === 'brasil') return 'br'
  if (view.kind === 'regiao') return `reg-${view.regiao}`
  if (view.kind === 'estado') return `uf-${view.uf}`
  return `mun-${view.municipioId}`
}

function BrasilPanel({
  hoveredRegion,
  onSelectRegion,
  onHoverRegion,
}: SidePanelProps) {
  return (
    <>
      <Capitular>
        <span className="font-display italic" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 80' }}>
          A
        </span>
        tlas das cidades brasileiras. Cinco regiões. Vinte e seis estados, mais
        o Distrito Federal. Cinco mil quinhentas e setenta e uma sedes
        municipais.
      </Capitular>

      <div>
        <SectionLabel n="01" titulo="Regiões" />
        <ul className="mt-3 divide-y divide-ink-15/70 hairline rounded-sm bg-paper-warm/60">
          {REGION_ORDER.map((id, i) => {
            const r = REGIONS[id]
            const active = hoveredRegion === id
            return (
              <li key={id}>
                <button
                  type="button"
                  onMouseEnter={() => onHoverRegion(id)}
                  onMouseLeave={() => onHoverRegion(null)}
                  onClick={() => onSelectRegion(id)}
                  className={
                    'w-full flex items-baseline gap-4 px-4 py-3 text-left group transition-colors ' +
                    (active ? 'bg-paper' : 'hover:bg-paper')
                  }
                >
                  <span className="num text-[10px] tracking-[0.22em] text-ink-50 w-6">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span
                    className="block w-3 h-3 rounded-full mt-1 shrink-0"
                    style={{ background: r.cor }}
                  />
                  <div className="flex-1">
                    <div
                      className="font-display text-2xl leading-tight"
                      style={{ fontVariationSettings: '"opsz" 36' }}
                    >
                      {r.nome}
                    </div>
                    <div className="text-sm text-ink-70 mt-0.5">{r.legenda}</div>
                  </div>
                  <span className="num text-[10px] text-ink-50 tabular-nums">
                    {r.ufs} UF
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </>
  )
}

function RegiaoPanel({
  regiao,
  hoveredUF,
  onSelectUF,
  onHoverUF,
}: SidePanelProps & { regiao: RegionId }) {
  const r = REGIONS[regiao]
  const states = STATES_GEO.features.filter(
    (f) => f.properties.regiao === regiao
  )
  return (
    <>
      <div>
        <div
          className="num text-[10px] tracking-[0.3em] uppercase text-ink-50"
          style={{ color: r.cor }}
        >
          região · {r.id}
        </div>
        <h2
          className="font-display italic text-7xl leading-none mt-1 text-ink"
          style={{ fontVariationSettings: '"opsz" 144, "SOFT" 80' }}
        >
          {r.nome}
        </h2>
        <p className="mt-3 text-ink-70 text-base max-w-md">{r.legenda}</p>
      </div>

      <div>
        <SectionLabel n="02" titulo={`Estados · ${states.length}`} />
        <ul className="mt-3 grid grid-cols-2 gap-px bg-ink-15 hairline">
          {states
            .sort((a, b) => a.properties.nome.localeCompare(b.properties.nome))
            .map((f) => {
              const p = f.properties
              const cap = MUNICIPIOS_BY_UF[p.sigla]?.length ?? 0
              const active = hoveredUF === p.sigla
              return (
                <li key={p.sigla}>
                  <button
                    type="button"
                    onMouseEnter={() => onHoverUF(p.sigla)}
                    onMouseLeave={() => onHoverUF(null)}
                    onClick={() => onSelectUF(p.sigla)}
                    className={
                      'w-full text-left p-3 transition-colors ' +
                      (active ? 'bg-paper' : 'bg-paper-warm hover:bg-paper')
                    }
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="num text-[10px] tracking-[0.18em] text-ink-50">
                        {p.sigla}
                      </span>
                      <span className="num text-[10px] text-ink-30">
                        {cap.toLocaleString('pt-BR')} mun.
                      </span>
                    </div>
                    <div
                      className="font-display text-lg mt-1 leading-tight"
                      style={{ fontVariationSettings: '"opsz" 24' }}
                    >
                      {p.nome}
                    </div>
                  </button>
                </li>
              )
            })}
        </ul>
      </div>
    </>
  )
}

function EstadoPanel({
  uf,
  hoveredMun,
  onSelectMun,
  collapsed,
}: SidePanelProps & { uf: string; collapsed?: boolean }) {
  const f = STATES_BY_SIGLA[uf]
  const muns = MUNICIPIOS_BY_UF[uf] ?? []
  const p = f?.properties
  const r = p ? REGIONS[p.regiao] : null

  const [query, setQuery] = useState('')

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? muns.filter((m) => m.nome.toLowerCase().includes(q))
      : muns
    return [...filtered].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [query, muns])

  if (!f || !p || !r) return null

  if (collapsed) {
    return (
      <div className="border-t border-ink-15 pt-6">
        <div className="num text-[10px] tracking-[0.3em] uppercase text-ink-50 flex items-center gap-3">
          <span style={{ color: r.cor }}>
            {p.sigla} · {r.nome}
          </span>
          <span className="text-ink-30">·</span>
          <span>{muns.length.toLocaleString('pt-BR')} municípios</span>
        </div>
        <h3
          className="font-display italic text-3xl leading-none mt-1 text-ink"
          style={{ fontVariationSettings: '"opsz" 36, "SOFT" 50' }}
        >
          {p.nome}
        </h3>
        <CityList
          rows={rows.slice(0, 80)}
          hoveredMun={hoveredMun}
          onSelectMun={onSelectMun}
          maxHeight="24vh"
        />
      </div>
    )
  }

  return (
    <>
      <div>
        <div className="flex items-center gap-2">
          <span
            className="num text-[10px] tracking-[0.3em] uppercase"
            style={{ color: r.cor }}
          >
            {p.sigla} · {r.nome}
          </span>
        </div>
        <h2
          className="font-display italic text-6xl leading-none mt-1 text-ink"
          style={{ fontVariationSettings: '"opsz" 144, "SOFT" 80' }}
        >
          {p.nome}
        </h2>
        <div className="num text-[11px] mt-2 text-ink-50 flex gap-4 flex-wrap">
          <span>
            <span className="text-ink">{muns.length.toLocaleString('pt-BR')}</span>{' '}
            municípios
          </span>
          <span>código IBGE {p.id}</span>
        </div>
      </div>

      <div>
        <label
          className="block num text-[10px] tracking-[0.22em] uppercase text-ink-50 mb-1"
          htmlFor="mun-search"
        >
          Filtrar municípios
        </label>
        <input
          id="mun-search"
          type="text"
          placeholder={`Buscar em ${p.nome}…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full bg-transparent border-b border-ink-30 focus:border-ink outline-none py-1 font-display italic text-xl placeholder:text-ink-30"
          style={{ fontVariationSettings: '"opsz" 24' }}
        />
      </div>

      <CityList
        rows={rows.slice(0, 320)}
        hoveredMun={hoveredMun}
        onSelectMun={onSelectMun}
        showFooter={
          rows.length > 320
            ? `+ ${(rows.length - 320).toLocaleString('pt-BR')} mais — refine a busca`
            : undefined
        }
        maxHeight="56vh"
      />
    </>
  )
}

interface CityListProps {
  rows: Municipio[]
  hoveredMun: number | null
  onSelectMun: (id: number) => void
  maxHeight: string
  showFooter?: string
}

function CityList({
  rows,
  hoveredMun,
  onSelectMun,
  maxHeight,
  showFooter,
}: CityListProps) {
  return (
    <div>
      <div className="overflow-auto -mx-1 px-1" style={{ maxHeight }}>
        <ul className="divide-y divide-ink-15/50">
          {rows.map((m) => {
            const active = hoveredMun === m.id
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onSelectMun(m.id)}
                  className={
                    'w-full text-left flex items-baseline gap-3 px-2 py-1.5 transition-colors ' +
                    (active
                      ? 'bg-paper text-ink'
                      : 'text-ink-70 hover:bg-paper hover:text-ink')
                  }
                >
                  <span
                    className="font-display text-base leading-tight truncate flex-1"
                    style={{ fontVariationSettings: '"opsz" 18' }}
                    title={m.nome}
                  >
                    {m.nome}
                  </span>
                  <span className="num text-[10px] text-ink-30 tabular-nums">
                    {m.id}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
      {showFooter && (
        <div className="flex justify-end items-center mt-2 num text-[10px] text-ink-50">
          <span>{showFooter}</span>
        </div>
      )}
    </div>
  )
}

function CidadePanel({ municipioId }: { municipioId: number }) {
  const m = MUNICIPIOS_BY_ID[municipioId]

  // Tag the loaded result with the id it belongs to so the render derives
  // "fresh for current município" without ever resetting state in an effect.
  const [loaded, setLoaded] = useState<{
    id: number
    payload: EstabelecimentosPayload | null
  } | null>(null)

  useEffect(() => {
    if (!m) return
    let cancelled = false
    fetchEstabelecimentos(m.id).then((p) => {
      if (cancelled) return
      setLoaded({ id: m.id, payload: p })
    })
    return () => {
      cancelled = true
    }
  }, [m])

  const isCurrent = !!(loaded && m && loaded.id === m.id)
  const loading = !isCurrent
  const payload = isCurrent && loaded ? loaded.payload : null
  const hasCnes = !loading && payload !== null

  if (!m) return null
  const r = REGIONS[m.regiao]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="num text-[10px] tracking-[0.3em] uppercase text-terra">
          município · IBGE {m.id}
        </div>
        <h3
          className="font-display italic text-6xl leading-[0.9] mt-1 text-ink"
          style={{ fontVariationSettings: '"opsz" 144, "SOFT" 80' }}
        >
          {m.nome}
        </h3>
        <div className="num text-[11px] mt-3 text-ink-50 flex gap-4 flex-wrap">
          <span style={{ color: r.cor }}>
            {m.uf} · {r.nome}
          </span>
        </div>
      </div>

      <EstabelecimentosSection
        hasCnes={hasCnes}
        loading={loading}
        payload={payload}
      />
    </div>
  )
}

function EstabelecimentosSection({
  hasCnes,
  loading,
  payload,
}: {
  hasCnes: boolean
  loading: boolean
  payload: EstabelecimentosPayload | null
}) {
  if (loading) {
    return (
      <div>
        <SectionLabel n="03" titulo="Estabelecimentos · CNES" />
        <p className="mt-3 num text-[10px] tracking-[0.22em] uppercase text-ink-50">
          carregando…
        </p>
      </div>
    )
  }
  if (!hasCnes || !payload) {
    return (
      <div>
        <SectionLabel n="03" titulo="Estabelecimentos · CNES" />
        <p className="mt-3 text-ink-50 text-sm leading-relaxed italic font-display">
          Sem dados CNES carregados para este município ainda.
        </p>
      </div>
    )
  }

  const porGrupo = agregarPorGrupo(payload.por_tipo)

  return (
    <>
      <div>
        <SectionLabel n="03" titulo="Estabelecimentos · CNES" />
        <div className="mt-3 flex items-baseline gap-3 flex-wrap">
          <span
            className="font-display italic text-5xl leading-none text-ink"
            style={{ fontVariationSettings: '"opsz" 64, "SOFT" 60' }}
          >
            {payload.total_relevante_generalista.toLocaleString('pt-BR')}
          </span>
          <span className="text-ink-70 text-sm leading-snug max-w-[200px]">
            unidades onde generalista tipicamente trabalha
          </span>
        </div>
        <div className="num text-[10px] mt-2 text-ink-50 tracking-[0.15em]">
          de {payload.total_no_municipio.toLocaleString('pt-BR')} estabelecimentos
          totais · fonte {payload.fonte}
        </div>
      </div>

      <div>
        <div className="num text-[10px] tracking-[0.22em] uppercase text-ink-50 mb-2">
          por grupo
        </div>
        <ul className="divide-y divide-ink-15/70 hairline rounded-sm bg-paper-warm/60">
          {porGrupo.map(([grupo, n, tipos]) => (
            <li
              key={grupo}
              className="flex items-baseline justify-between gap-3 px-3 py-2"
            >
              <span className="flex-1 min-w-0">
                <span
                  className="font-display text-base leading-tight block"
                  style={{ fontVariationSettings: '"opsz" 18' }}
                >
                  {grupo}
                </span>
                <span className="num text-[10px] text-ink-50 tracking-[0.1em] block truncate">
                  {tipos.join(' · ')}
                </span>
              </span>
              <span className="num text-xs tabular-nums text-ink-70">
                {n.toLocaleString('pt-BR')}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <EstabelecimentosList estabelecimentos={payload.estabelecimentos} />
    </>
  )
}

function EstabelecimentosList({
  estabelecimentos,
}: {
  estabelecimentos: Estabelecimento[]
}) {
  const [query, setQuery] = useState('')
  const [grupoFiltro, setGrupoFiltro] = useState<string | null>(null)

  const gruposPresentes = useMemo(() => {
    const set = new Set<string>()
    for (const e of estabelecimentos) set.add(tipoToGrupo(e.tp_unid))
    return GRUPO_ORDER.filter((g) => set.has(g))
  }, [estabelecimentos])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return estabelecimentos.filter((e) => {
      if (grupoFiltro && tipoToGrupo(e.tp_unid) !== grupoFiltro) return false
      if (!q) return true
      const nome = (e.nome ?? '').toLowerCase()
      return (
        nome.includes(q) ||
        e.cnes.toLowerCase().includes(q) ||
        (e.cep ?? '').toLowerCase().includes(q) ||
        e.tp_unid.toLowerCase().includes(q)
      )
    })
  }, [estabelecimentos, query, grupoFiltro])

  return (
    <div>
      <div className="num text-[10px] tracking-[0.22em] uppercase text-ink-50 mb-2">
        lista · {rows.length.toLocaleString('pt-BR')} registros
      </div>
      <div className="flex flex-col gap-2 mb-2">
        <input
          type="text"
          placeholder="filtrar por nome, CNES, CEP ou tipo…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full bg-transparent border-b border-ink-30 focus:border-ink outline-none py-1 font-display italic text-base placeholder:text-ink-30"
          style={{ fontVariationSettings: '"opsz" 18' }}
        />
        <div className="flex gap-1 flex-wrap">
          <button
            type="button"
            onClick={() => setGrupoFiltro(null)}
            className={
              'num text-[10px] tracking-[0.18em] uppercase px-2 py-1 border transition-colors ' +
              (grupoFiltro === null
                ? 'border-ink bg-ink text-paper'
                : 'border-ink-15 hover:border-ink-50')
            }
          >
            tudo
          </button>
          {gruposPresentes.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGrupoFiltro(g === grupoFiltro ? null : g)}
              className={
                'num text-[10px] tracking-[0.18em] uppercase px-2 py-1 border transition-colors ' +
                (grupoFiltro === g
                  ? 'border-ink bg-ink text-paper'
                  : 'border-ink-15 hover:border-ink-50')
              }
            >
              {g}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-auto -mx-1 px-1" style={{ maxHeight: '40vh' }}>
        <ul className="divide-y divide-ink-15/50">
          {rows.slice(0, 240).map((e) => (
            <li
              key={e.cnes}
              className="px-2 py-2 flex items-baseline gap-3"
              title={`${e.tp_unid} · CNPJ ${e.cnpj ?? '—'}`}
            >
              <span className="num text-[10px] text-ink-50 tabular-nums w-16 shrink-0">
                {e.cnes}
              </span>
              <span className="flex-1 min-w-0">
                <span
                  className="font-display text-sm leading-tight text-ink block truncate"
                  style={{ fontVariationSettings: '"opsz" 18' }}
                >
                  {e.nome ?? e.tp_unid}
                </span>
                {e.nome && (
                  <span className="num text-[9px] text-ink-50 tracking-[0.08em] block truncate">
                    {e.tp_unid}
                  </span>
                )}
              </span>
              <span className="num text-[10px] text-ink-30 tabular-nums shrink-0">
                {e.cep ?? '—'}
              </span>
              {e.atende_sus === 'S' || e.atende_sus === '1' ? (
                <span
                  className="num text-[9px] tracking-[0.18em] uppercase"
                  style={{ color: 'var(--verde-600, #4a6b3a)' }}
                  title="atende SUS"
                >
                  sus
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        {rows.length > 240 && (
          <div className="num text-[10px] text-ink-50 mt-2 text-right">
            + {(rows.length - 240).toLocaleString('pt-BR')} — refine a busca
          </div>
        )}
      </div>
    </div>
  )
}

const GRUPO_ORDER = [
  'Atenção primária',
  'Hospital',
  'Urgência',
  'Especialidade',
  'Consultório',
  'Outros',
] as const

type Grupo = (typeof GRUPO_ORDER)[number]

const TIPO_TO_GRUPO: Record<string, Grupo> = {
  'Centro de Saúde / UBS': 'Atenção primária',
  'Posto de Saúde': 'Atenção primária',
  'Centro de Apoio à Saúde da Família': 'Atenção primária',
  'Hospital Geral': 'Hospital',
  'Hospital Especializado': 'Hospital',
  'Unidade Mista': 'Hospital',
  'Hospital/Dia - Isolado': 'Hospital',
  'Pronto Socorro Geral': 'Urgência',
  'Pronto Socorro Especializado': 'Urgência',
  'Pronto Atendimento': 'Urgência',
  'Unidade Móvel Pré-Hospitalar - Urgência': 'Urgência',
  'Clínica/Centro de Especialidade': 'Especialidade',
  'Policlínica': 'Especialidade',
  'Consultório Isolado': 'Consultório',
}

function tipoToGrupo(tp: string): Grupo {
  return TIPO_TO_GRUPO[tp] ?? 'Outros'
}

function agregarPorGrupo(
  porTipo: Record<string, number>
): Array<[Grupo, number, string[]]> {
  const agg: Record<Grupo, { n: number; tipos: Array<[string, number]> }> = {
    'Atenção primária': { n: 0, tipos: [] },
    Hospital: { n: 0, tipos: [] },
    Urgência: { n: 0, tipos: [] },
    Especialidade: { n: 0, tipos: [] },
    Consultório: { n: 0, tipos: [] },
    Outros: { n: 0, tipos: [] },
  }
  for (const [tipo, n] of Object.entries(porTipo)) {
    const g = tipoToGrupo(tipo)
    agg[g].n += n
    agg[g].tipos.push([tipo, n])
  }
  return GRUPO_ORDER.filter((g) => agg[g].n > 0).map((g) => [
    g,
    agg[g].n,
    agg[g].tipos
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${t} ${n}`),
  ])
}

function SectionLabel({ n, titulo }: { n: string; titulo: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="num text-[10px] tracking-[0.3em] text-ink-50">{n}</span>
      <div className="rule h-px flex-1 mb-1" />
      <span className="num text-[10px] tracking-[0.3em] uppercase text-ink-70">
        {titulo}
      </span>
    </div>
  )
}

function Capitular({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-ink-70 text-lg leading-relaxed"
      style={{ textWrap: 'pretty' as never }}
    >
      {children}
    </p>
  )
}
