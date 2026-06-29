import { readdirSync, existsSync, readFileSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, basename } from 'node:path'

import Sonda from 'sonda/vite'
import { build } from 'vite'

const ROOT = new URL('..', import.meta.url).pathname
const PACKAGES_DIR = join(ROOT, 'packages')
const TMP_DIR = join(ROOT, 'node_modules', '.bundle-size-tmp')
rmSync(TMP_DIR, { recursive: true, force: true })

const ENTRY_CANDIDATES = (pkgDir: string) => [
  'src/index.ts',
  `src/${basename(pkgDir)}/index.ts`,
  `src/${basename(pkgDir).replace(/^@.*\//, '')}/index.ts`,
]

function findEntry(pkgDir: string): string | null {
  for (const rel of ENTRY_CANDIDATES(pkgDir)) {
    const abs = join(pkgDir, rel)
    if (existsSync(abs)) return abs
  }
  return null
}

function fmt(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

type SondaResource = {
  kind: 'filesystem' | 'sourcemap' | 'asset' | 'chunk'
  name: string
  uncompressed: number
  gzip?: number
  brotli?: number
  parent?: string
}
type SondaReport = { resources: SondaResource[] }

const pkgs = readdirSync(PACKAGES_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => join(PACKAGES_DIR, d.name))

const summary: Array<{
  pkg: string
  raw: number
  gz: number
  top: Array<[string, number, number]>
}> = []

for (const pkg of pkgs) {
  const name = basename(pkg)
  const entry = findEntry(pkg)
  if (!entry) {
    console.log(`\n[skip] ${name} — no entry point found`)
    continue
  }

  const reportDir = join(pkg, '.sonda')
  rmSync(reportDir, { recursive: true, force: true })

  console.log(`\n[build] ${name} (entry: ${entry.replace(ROOT, '')})`)
  await build({
    configFile: false,
    root: pkg,
    logLevel: 'warn',
    build: {
      lib: { entry, formats: ['es'], fileName: 'bundle' },
      outDir: join(TMP_DIR, name),
      emptyOutDir: true,
      sourcemap: true,
      minify: 'esbuild',
      rollupOptions: { external: [] },
    },
    plugins: [
      Sonda({
        format: ['html', 'json'],
        filename: 'sonda',
        outputDir: reportDir,
        gzip: true,
      }),
    ],
  })

  const jsonPath = join(reportDir, 'sonda.json')
  if (!existsSync(jsonPath)) {
    console.log(`  (no Sonda report produced)`)
    continue
  }

  const report = JSON.parse(readFileSync(jsonPath, 'utf8')) as SondaReport
  unlinkSync(jsonPath)
  const assets = report.resources.filter(r => r.kind === 'asset' && r.name.endsWith('.js'))
  const raw = assets.reduce((s, a) => s + a.uncompressed, 0)
  const gz = assets.reduce((s, a) => s + (a.gzip ?? 0), 0)

  const top = report.resources
    .filter(r => r.kind === 'chunk')
    .toSorted((a, b) => b.uncompressed - a.uncompressed)
    .slice(0, 15)
    .map(r => [r.name, r.uncompressed, r.gzip ?? 0] as [string, number, number])

  summary.push({ pkg: name, raw, gz, top })
}

console.log('\n\n=== Summary ===')
console.log('Package                          Raw         Gzip')
console.log('-'.repeat(60))
for (const s of summary) {
  console.log(`${s.pkg.padEnd(32)} ${fmt(s.raw).padStart(10)}  ${fmt(s.gz).padStart(10)}`)
}

for (const s of summary) {
  console.log(`\n--- ${s.pkg}: top contributors (after tree-shake) ---`)
  for (const [name, raw, gz] of s.top) {
    console.log(`  ${fmt(raw).padStart(10)}  ${fmt(gz).padStart(10)}  ${name}`)
  }
  console.log(`  Full report: packages/${s.pkg}/.sonda/sonda.html`)
}

const md: string[] = []
md.push(`# Bundle sizes`)
md.push('')
md.push(`Generated: ${new Date().toISOString()}`)
md.push(`Bundler: Vite (Rolldown) + Sonda. Deps bundled in, minified, ESM.`)
md.push('')
md.push(`## Summary`)
md.push('')
for (const s of summary) {
  md.push(`- \`${s.pkg}\` — ${fmt(s.raw)} raw / ${fmt(s.gz)} gzip`)
}
md.push('')
for (const s of summary) {
  md.push(`## ${s.pkg}`)
  md.push('')
  md.push(`Full report: [\`packages/${s.pkg}/.sonda/sonda.html\`](packages/${s.pkg}/.sonda/sonda.html)`)
  md.push('')
  md.push(`Top contributors (after tree-shake):`)
  md.push('')
  for (const [name, raw, gz] of s.top) {
    md.push(`- ${fmt(raw)} raw / ${fmt(gz)} gzip — \`${name}\``)
  }
  md.push('')
}

const mdPath = join(ROOT, 'SONDA.md')
writeFileSync(mdPath, md.join('\n'))
console.log(`\nWrote ${mdPath}`)

rmSync(TMP_DIR, { recursive: true, force: true })
