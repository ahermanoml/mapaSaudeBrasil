export interface Estabelecimento {
  cnes: string
  tp_unid_cod: string
  tp_unid: string
  nome?: string
  cnpj?: string
  cnpj_mantenedora?: string
  cep?: string
  atende_sus?: string
  atendimento_ambulatorial?: string
  atendimento_hospitalar?: string
  urgencia_emergencia?: string
  natureza_juridica?: string
}

export interface EstabelecimentosPayload {
  ibge: number
  codufmun: string
  fonte: string
  total_no_municipio: number
  total_relevante_generalista: number
  por_tipo: Record<string, number>
  estabelecimentos: Estabelecimento[]
}

interface ManifestEntry {
  ibge: number
  slug: string
}

const cityCache = new Map<number, Promise<EstabelecimentosPayload | null>>()
let manifestPromise: Promise<Map<number, string>> | null = null

function loadManifest(): Promise<Map<number, string>> {
  if (manifestPromise) return manifestPromise
  manifestPromise = (async () => {
    try {
      const r = await fetch(
        `${import.meta.env.BASE_URL}data/enriquecido/_index.json`
      )
      if (!r.ok) return new Map<number, string>()
      const rows = (await r.json()) as ManifestEntry[]
      return new Map(rows.map((r) => [r.ibge, r.slug]))
    } catch {
      return new Map<number, string>()
    }
  })()
  return manifestPromise
}

export function fetchEstabelecimentos(
  ibge: number
): Promise<EstabelecimentosPayload | null> {
  if (cityCache.has(ibge)) return cityCache.get(ibge)!
  const p = (async () => {
    const manifest = await loadManifest()
    const slug = manifest.get(ibge)
    if (!slug) return null
    try {
      const r = await fetch(
        `${import.meta.env.BASE_URL}data/enriquecido/${slug}.json`
      )
      if (!r.ok) return null
      return (await r.json()) as EstabelecimentosPayload
    } catch {
      return null
    }
  })()
  cityCache.set(ibge, p)
  return p
}
