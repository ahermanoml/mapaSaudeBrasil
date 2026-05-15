import type { MunicipioFeature } from '../types'

const cache = new Map<string, Promise<unknown>>()

// Persist expensive IBGE responses to localStorage. Keyed by `ibge:<key>`.
// Stored value: `{t: epoch_ms, v: <serialised>}`. TTL is generous (30 days)
// since malhas only change with boundary revisions.
const LS_PREFIX = 'ibge:'
const LS_TTL_MS = 30 * 24 * 60 * 60 * 1000

function lsGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { t: number; v: T }
    if (!parsed || typeof parsed.t !== 'number') return null
    if (Date.now() - parsed.t > LS_TTL_MS) return null
    return parsed.v
  } catch {
    return null
  }
}

function lsSet<T>(key: string, value: T): void {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify({ t: Date.now(), v: value }))
  } catch {
    // Quota or serialisation failure — silent; cache is best-effort.
  }
}

function memoLS<T>(
  key: string,
  serialise: (value: T) => unknown,
  hydrate: (raw: unknown) => T,
  run: () => Promise<T>
): Promise<T> {
  if (!cache.has(key)) {
    const stored = lsGet<unknown>(key)
    if (stored !== null) {
      cache.set(key, Promise.resolve(hydrate(stored)))
    } else {
      cache.set(
        key,
        run().then((v) => {
          lsSet(key, serialise(v))
          return v
        })
      )
    }
  }
  return cache.get(key) as Promise<T>
}

export interface MunicipioGeoCollection {
  type: 'FeatureCollection'
  features: MunicipioFeature[]
}

export function fetchMunicipiosGeo(uf: string): Promise<MunicipioGeoCollection> {
  return memoLS<MunicipioGeoCollection>(
    `mun-geo:${uf}`,
    (v) => v,
    (raw) => raw as MunicipioGeoCollection,
    async () => {
      const url = `https://servicodados.ibge.gov.br/api/v3/malhas/estados/${uf}?qualidade=intermediaria&formato=application/vnd.geo+json&intrarregiao=municipio`
      const r = await fetch(url)
      if (!r.ok) throw new Error(`falha ao carregar municípios de ${uf}`)
      return (await r.json()) as MunicipioGeoCollection
    }
  )
}
