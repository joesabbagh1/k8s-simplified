import { expect, test } from "vitest"
import { LESSONS } from "./data/lessons"
import { clip, headHtml, metaFor, ORIGIN } from "./meta"
import { matchPath, pathOf } from "./route"
import { indexed, pages, sitemap } from "./prerender"

const meta = (path: string) => metaFor(matchPath(path))

test("every indexed page has its own title and description", () => {
  const all = indexed.map(meta)
  expect(new Set(all.map((m) => m.title)).size).toBe(all.length)
  expect(new Set(all.map((m) => m.description)).size).toBe(all.length)
  for (const m of all) {
    expect(m.title.length, m.title).toBeLessThanOrEqual(60)
    expect(m.description.length, m.description).toBeLessThanOrEqual(160)
    expect(m.canonical).toBe(m.url)
  }
})

test("a lesson's steps and summary are canonical to the lesson", () => {
  for (const path of ["/rolling-update/2", "/rolling-update/summary"]) {
    expect(meta(path).canonical).toBe(`${ORIGIN}/rolling-update`)
    expect(meta(path).url).toBe(ORIGIN + path)
  }
})

test("only real pages match, and each leads back to its own path", () => {
  for (const path of [...indexed, "/rolling-update/1", "/rolling-update/summary"]) expect(pathOf(matchPath(path))).toBe(path)
  for (const path of ["/nope", "/404", "/lessons/1", "/rolling-update/0", "/rolling-update/99", "/rolling-update/x", "/rolling-update/1/2"]) {
    expect(matchPath(path).page, path).toBe("notFound")
  }
})

test("the 404 page asks not to be indexed and has no canonical address", () => {
  const head = headHtml(metaFor({ page: "notFound" }))
  expect(head).toContain('<meta name="robots" content="noindex" />')
  expect(head).not.toContain("canonical")
})

test("head tags are escaped", () => {
  const head = headHtml({ ...meta("/"), title: 'a "b" <c> & d', data: [{ x: "</script>" }] })
  expect(head).toContain("<title>a &quot;b&quot; &lt;c&gt; &amp; d</title>")
  expect(head).toContain('{"x":"\\u003c/script>"}')
})

test("clip cuts at a word", () => {
  expect(clip("short")).toBe("short")
  expect(clip("one two, three", 10)).toBe("one two…")
})

test("the sitemap lists the homepage, the lessons page and every lesson", () => {
  expect(sitemap().match(/<loc>/g)).toHaveLength(LESSONS.length + 2)
})

test("each prerendered page holds its own heading, and a lesson holds its whole text", () => {
  const built = new Map([...pages()].map((p) => [p.file, p]))
  for (const { file, body } of built.values()) expect(body.match(/<h1/g), file).toHaveLength(1)
  for (const lesson of LESSONS) {
    const text = new DOMParser().parseFromString(built.get(`${lesson.id}.html`)!.body, "text/html").body.textContent
    for (const step of lesson.steps) expect(text).toContain(step.body)
    expect(built.has(`${lesson.id}/${lesson.steps.length}.html`)).toBe(true)
  }
  expect(built.get("404.html")!.body).toContain("Page not found")
})
