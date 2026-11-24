// Runs after `vite build`: writes every page of the site to dist/ as its own HTML file, plus sitemap.xml.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { build } from "vite"

const root = resolve(import.meta.dirname, "..")
const dist = resolve(root, "dist")
const bundle = resolve(root, "dist-ssr")

await build({
  root,
  logLevel: "warn",
  build: { ssr: "src/prerender.tsx", outDir: bundle, emptyOutDir: true, copyPublicDir: false },
})
const { pages, sitemap } = await import(pathToFileURL(resolve(bundle, "prerender.js")).href)

const template = await readFile(resolve(dist, "index.html"), "utf8")
const HEAD = /<!-- scripts\/prerender\.mjs [^]*?<\/title>/
const ROOT = '<div id="root"></div>'
if (!HEAD.test(template) || !template.includes(ROOT)) throw new Error("dist/index.html has no title or root to fill; run vite build first")

let count = 0
for (const { file, head, body } of pages()) {
  const path = resolve(dist, file)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, template.replace(HEAD, () => head).replace(ROOT, () => `<div id="root">${body}</div>`))
  count++
}
await writeFile(resolve(dist, "sitemap.xml"), sitemap())
await rm(bundle, { recursive: true })
console.log(`prerendered ${count} pages`)
