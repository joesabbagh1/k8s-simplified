import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createAgent } from "@ui-sdk/react/agent"
import { beforeEach, expect, test } from "vitest"
import App from "./App"
import { useApp } from "./store"

const agent = createAgent()

beforeEach(() => {
  window.history.replaceState(null, "", "/deploy-an-app")
  useApp.setState({ libraryQuery: "", libraryFilter: "all" })
  useApp.setState({ pauseAfter: "step", speed: 1 })
  useApp.setState({ stageView: "cluster", flowTab: "events", flowOpen: false, diagramOnly: false })
  useApp.getState().openLesson("deploy-an-app")
})

const details = () => screen.getByRole("complementary", { name: "Details" })

test("choosing a step shows its details, its events and a shareable link", async () => {
  const user = userEvent.setup()
  render(<App />)
  const steps = screen.getByRole("listbox", { name: "Steps" })
  await user.click(within(steps).getByRole("option", { name: "Scheduling" }))

  expect(within(details()).getByRole("heading", { name: "Scheduling" })).toBeTruthy()
  expect(within(details()).getByText("Step 5 of 7")).toBeTruthy()
  expect(window.location.pathname).toBe("/deploy-an-app/5")
  expect(document.title).toBe("Deploy an app · Step 5 of 7 · K8s Simplified")

  await user.click(screen.getByRole("button", { name: /^Events/ }))
  const flow = screen.getByRole("region", { name: "Event flow" })
  expect(within(flow).getAllByRole("option")).toHaveLength(13)
})

test("the events drawer starts closed and E opens it", async () => {
  const user = userEvent.setup()
  render(<App />)
  const toggle = screen.getByRole("button", { name: /^Events/ })
  expect(toggle.getAttribute("aria-expanded")).toBe("false")
  await user.keyboard("e")
  expect(toggle.getAttribute("aria-expanded")).toBe("true")
})

test("a link to a step opens that step", () => {
  window.history.replaceState(null, "", "/request-finds-pod/6")
  render(<App />)
  expect(within(details()).getByRole("heading", { name: "Into the Pod" })).toBeTruthy()
  expect(screen.getByRole("navigation", { name: "Zoom level" }).textContent).toContain("node-2")
})

test("the zoom breadcrumb shows only inside a node, and Follow lesson zooms back", async () => {
  const user = userEvent.setup()
  render(<App />)
  expect(screen.queryByRole("navigation", { name: "Zoom level" })).toBeNull()
  await user.click(screen.getByRole("button", { name: "Look inside node-1" }))
  const crumbs = screen.getByRole("navigation", { name: "Zoom level" })
  expect(crumbs.textContent).toContain("node-1")
  await user.click(within(crumbs).getByRole("button", { name: /Follow lesson/ }))
  expect(screen.queryByRole("navigation", { name: "Zoom level" })).toBeNull()
})

test("the sequence view draws one lane per component", async () => {
  const user = userEvent.setup()
  render(<App />)
  await user.click(screen.getByRole("radio", { name: "Sequence" }))
  expect(await screen.findByText("scheduler")).toBeTruthy()
  expect(screen.getByText("controllers")).toBeTruthy()
})

test("the summary appears after the last step", () => {
  render(<App />)
  act(() => useApp.getState().showSummary())
  expect(screen.getByRole("heading", { name: "Pod running" })).toBeTruthy()
  expect(window.location.pathname).toBe("/deploy-an-app/summary")
})

test("the Lessons link opens a page that searches and filters every lesson", async () => {
  const user = userEvent.setup()
  render(<App />)
  await user.click(screen.getByRole("link", { name: /^Lessons/ }))
  expect(window.location.pathname).toBe("/lessons")
  const page = screen.getByRole("main", { name: "Lessons" })
  const lessonLinks = () => within(page).queryAllByRole("link").filter((a) => /^\/[^/]+$/.test(a.getAttribute("href")!))
  expect(lessonLinks()).toHaveLength(25)

  await user.click(within(page).getByRole("radio", { name: /^Control plane/ }))
  expect(lessonLinks()).toHaveLength(5)

  await user.click(within(page).getByRole("radio", { name: /^All/ }))
  await user.type(within(page).getByRole("searchbox", { name: "Search lessons and steps" }), "dns")
  expect(lessonLinks().map((a) => a.textContent)).toContain("DNS in the cluster")
  expect(lessonLinks().length).toBeLessThan(25)

  await user.click(within(page).getByRole("link", { name: "DNS in the cluster" }))
  expect(within(details()).getByRole("heading", { name: "DNS in the cluster" })).toBeTruthy()
  expect(within(details()).getByRole("button", { name: /Play 6 steps/ })).toBeTruthy()
})

test("a search that matches nothing offers to clear the filters", async () => {
  const user = userEvent.setup()
  window.history.replaceState(null, "", "/lessons")
  render(<App />)
  const page = screen.getByRole("main", { name: "Lessons" })
  await user.type(within(page).getByRole("searchbox"), "zzzz")
  expect(within(page).getByText(/No lesson matches/)).toBeTruthy()
  await user.click(within(page).getByRole("button", { name: "Clear filters" }))
  expect(within(page).getByRole("link", { name: "Deploy an app" })).toBeTruthy()
})

test("a search shows the matching steps, and a step link opens that step", async () => {
  const user = userEvent.setup()
  window.history.replaceState(null, "", "/lessons")
  render(<App />)
  const page = screen.getByRole("main", { name: "Lessons" })
  await user.type(within(page).getByRole("searchbox"), "scheduling")
  const steps = within(page).getByRole("list", { name: "Matching steps in Deploy an app" })
  await user.click(within(steps).getByRole("link", { name: /Scheduling/ }))
  expect(within(details()).getByRole("heading", { name: "Scheduling" })).toBeTruthy()
})

test("lesson keys stay off on the lessons page", async () => {
  const user = userEvent.setup()
  window.history.replaceState(null, "", "/lessons")
  render(<App />)
  await user.keyboard("e")
  expect(useApp.getState().flowOpen).toBe(false)
})

test("an agent can find every control and drive the lesson", async () => {
  render(<App />)
  const named = () => agent.snapshot().filter((entry) => !entry.offPage && entry.component !== "more")
  for (const entry of named()) expect(entry.label, `${entry.component} ${entry.ref} has no name`).toBeTruthy()

  const labels = named().map((entry) => entry.label)
  for (const label of ["Steps", "Diagram view", "Playback", "Playback settings"]) {
    expect(labels, `${label} is missing from the snapshot`).toContain(label)
  }

  const settings = named().find((entry) => entry.component === "popover" && entry.label === "Playback settings")!
  const first = await agent.act({
    steps: [
      { ref: "Diagram view", action: "setValue", args: ["sequence"] },
      { ref: settings.ref, action: "setOpen", args: [true] },
    ],
  })
  expect(first.ok, first.error?.message).toBe(true)

  const second = await agent.act({
    steps: [
      { ref: "Pause after", action: "setValue", args: ["event"] },
      { ref: "Speed", action: "setValue", args: ["2"] },
    ],
  })
  expect(second.ok, second.error?.message).toBe(true)
  expect(useApp.getState()).toMatchObject({ stageView: "sequence", speed: 2, pauseAfter: "event" })
})

test("an agent can search and filter the lessons page", async () => {
  window.history.replaceState(null, "", "/lessons")
  render(<App />)
  const named = agent.snapshot().filter((entry) => !entry.offPage && entry.component !== "more")
  for (const entry of named) expect(entry.label, `${entry.component} ${entry.ref} has no name`).toBeTruthy()
  const result = await agent.act({
    steps: [
      { ref: "Category", action: "setValue", args: ["network"] },
      { ref: "Search lessons and steps", action: "setValue", args: ["vxlan"] },
    ],
  })
  expect(result.ok, result.error?.message).toBe(true)
  expect(useApp.getState()).toMatchObject({ libraryFilter: "network", libraryQuery: "vxlan" })
})

test("with no lesson in the address the homepage opens, and its links lead into the lessons", async () => {
  const user = userEvent.setup()
  window.history.replaceState(null, "", "/")
  useApp.setState({ page: "home" })
  render(<App />)
  const home = screen.getByRole("main", { name: /Watch a Kubernetes cluster work/ })
  await user.click(within(home).getByRole("link", { name: /Start the first lesson/ }))
  expect(within(details()).getByRole("heading", { name: "Deploy an app" })).toBeTruthy()
})

test("the logo goes home from a lesson", async () => {
  const user = userEvent.setup()
  render(<App />)
  await user.click(screen.getByRole("link", { name: "K8s Simplified, home" }))
  expect(await screen.findByRole("main", { name: /Watch a Kubernetes cluster work/ })).toBeTruthy()
  expect(useApp.getState().page).toBe("home")
  expect(window.location.pathname).toBe("/")
})

test("a category on the homepage opens the lessons page filtered to it", async () => {
  const user = userEvent.setup()
  window.history.replaceState(null, "", "/")
  render(<App />)
  await user.click(screen.getByRole("link", { name: /All network lessons/ }))
  const page = await screen.findByRole("main", { name: "Lessons" })
  expect(within(page).getByRole("radio", { name: /^Network/ }).getAttribute("aria-checked")).toBe("true")
  expect(within(page).queryByRole("heading", { name: /^Node/ })).toBeNull()
})

test("an old #/ link still opens its step, and the address becomes a plain path", () => {
  window.history.replaceState(null, "", "/#/request-finds-pod/6")
  render(<App />)
  expect(within(details()).getByRole("heading", { name: "Into the Pod" })).toBeTruthy()
  expect(window.location.pathname).toBe("/request-finds-pod/6")
  expect(window.location.hash).toBe("")
})

test("Back returns to the page before, without reloading", async () => {
  const user = userEvent.setup()
  window.history.replaceState(null, "", "/lessons")
  render(<App />)
  await user.click(screen.getByRole("link", { name: "DNS in the cluster" }))
  expect(window.location.pathname).toBe("/dns-in-cluster")
  act(() => window.history.back())
  expect(await screen.findByRole("main", { name: "Lessons" })).toBeTruthy()
})
