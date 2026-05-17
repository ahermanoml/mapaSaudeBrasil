#!/usr/bin/env node
/**
 * Roda Lighthouse N vezes contra o build de produção servido por `vite preview`
 * e reporta a mediana das métricas chave.
 *
 * Uso:
 *   npm run bench                    # 5 runs (default)
 *   npm run bench -- 10              # 10 runs
 *   npm run bench -- 5 --no-build    # pula build, reusa dist/
 *
 * Saídas:
 *   - mediana no stdout
 *   - JSONs por run em .lighthouse/run-N.json
 *   - resumo em .lighthouse/summary.json (rastreável entre commits)
 *
 * Requer Chrome. Se não encontrar, baixa Chrome-for-Testing em
 * .lighthouse/chrome na primeira execução (~180MB, sem sudo).
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

const args = process.argv.slice(2)
const N = Number(args.find((a) => /^\d+$/.test(a)) ?? 5)
const SKIP_BUILD = args.includes('--no-build')
const PORT = 4173
const URL = `http://localhost:${PORT}/`
const OUT_DIR = join(process.cwd(), '.lighthouse')
const CHROME_CACHE = join(OUT_DIR, 'chrome')

function median(arr) {
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function run(cmd, argv, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: 'inherit', ...opts })
    p.on('close', (c) =>
      c === 0 ? resolve() : reject(new Error(`${cmd} ${argv.join(' ')} → exit ${c}`))
    )
    p.on('error', reject)
  })
}

async function waitForServer(url, timeoutMs = 30_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`servidor não respondeu em ${timeoutMs}ms`)
}

async function findCachedChrome() {
  const base = join(CHROME_CACHE, 'chrome')
  if (!existsSync(base)) return null
  const versions = await readdir(base)
  for (const v of versions) {
    const candidate = join(base, v, 'chrome-linux64', 'chrome')
    if (existsSync(candidate)) return candidate
  }
  return null
}

async function ensureChrome() {
  const tryPaths = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean)
  for (const p of tryPaths) if (existsSync(p)) return p
  const cached = await findCachedChrome()
  if (cached) return cached
  console.log('Chrome não encontrado. Baixando Chrome-for-Testing em .lighthouse/chrome…')
  await mkdir(CHROME_CACHE, { recursive: true })
  await run('npx', ['--yes', '@puppeteer/browsers', 'install', 'chrome@stable', '--path', CHROME_CACHE])
  const path = await findCachedChrome()
  if (!path) throw new Error('Chrome instalado mas binário não localizado')
  return path
}

async function main() {
  if (!SKIP_BUILD || !existsSync('dist')) {
    console.log('build…')
    await run('npm', ['run', 'build'])
  }
  await mkdir(OUT_DIR, { recursive: true })

  const chromePath = await ensureChrome()
  console.log(`chrome: ${chromePath}`)

  console.log(`subindo vite preview em :${PORT}…`)
  const preview = spawn(
    'node_modules/.bin/vite',
    ['preview', '--port', String(PORT), '--strictPort'],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let previewDone = false
  preview.on('exit', () => {
    previewDone = true
  })

  const cleanup = () => {
    if (previewDone) return
    try {
      preview.kill('SIGTERM')
      setTimeout(() => {
        if (!previewDone) {
          try { preview.kill('SIGKILL') } catch {}
        }
      }, 2000).unref()
    } catch {}
  }
  process.on('exit', cleanup)
  process.on('SIGINT', () => { cleanup(); process.exit(130) })
  process.on('SIGTERM', () => { cleanup(); process.exit(143) })

  await waitForServer(URL)
  console.log(`servidor up — rodando ${N} runs do Lighthouse…\n`)

  const KEYS = [
    'first-contentful-paint',
    'largest-contentful-paint',
    'total-blocking-time',
    'interactive',
    'cumulative-layout-shift',
    'speed-index',
  ]
  const metrics = Object.fromEntries(KEYS.map((k) => [k, []]))
  metrics['performance-score'] = []

  for (let i = 1; i <= N; i++) {
    const out = join(OUT_DIR, `run-${i}.json`)
    process.stdout.write(`  run ${i}/${N}… `)
    const t0 = Date.now()
    await run(
      'node_modules/.bin/lighthouse',
      [
        URL,
        '--output=json',
        `--output-path=${out}`,
        '--preset=desktop',
        '--chrome-flags=--headless=new --no-sandbox',
        '--quiet',
      ],
      {
        stdio: ['ignore', 'ignore', 'inherit'],
        env: { ...process.env, CHROME_PATH: chromePath },
      }
    )
    const data = JSON.parse(await readFile(out, 'utf8'))
    metrics['performance-score'].push(data.categories.performance.score * 100)
    for (const k of KEYS) metrics[k].push(data.audits[k].numericValue)
    console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`)
  }

  const meds = {}
  for (const [k, v] of Object.entries(metrics)) meds[k] = median(v)

  console.log(`\nmediana de ${N} runs:`)
  const ms = (n) => {
    const r = Math.round(n)
    const base = `${r} ms`.padStart(8)
    return r >= 1000 ? `${base}  (${(r / 1000).toFixed(2).replace('.', ',')} s)` : base
  }
  console.log(`  FCP (First Contentful Paint)   ${ms(meds['first-contentful-paint'])}`)
  console.log(`  LCP (Largest Contentful Paint) ${ms(meds['largest-contentful-paint'])}`)
  console.log(`  TBT (Total Blocking Time)      ${ms(meds['total-blocking-time'])}`)
  console.log(`  TTI (Time to Interactive)      ${ms(meds['interactive'])}`)
  console.log(`  Speed Index                    ${ms(meds['speed-index'])}`)
  console.log(`  CLS                            ${meds['cumulative-layout-shift'].toFixed(3).padStart(8)}`)
  console.log(`  Performance score              ${Math.round(meds['performance-score']).toString().padStart(5)}/100`)

  const summaryPath = join(OUT_DIR, 'summary.json')
  await writeFile(
    summaryPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        runs: N,
        url: URL,
        median: meds,
        raw: metrics,
      },
      null,
      2
    )
  )
  console.log(`\nresumo: ${summaryPath}`)

  cleanup()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
