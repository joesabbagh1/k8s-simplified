import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test } from "vitest"
import App from "../App"
import { useApp } from "../store"
import { clampBox, panBy, zoomAt } from "./camera"
import { WORLD, type Box } from "./world"

beforeEach(() => {
  window.history.replaceState(null, "", "/deploy-an-app")
  useApp.getState().openLesson("deploy-an-app")
})

/** the stage svg, laid out 1:1 with the world so client pixels are viewBox units */
function stage() {
  const svg = screen.getByRole("group", { name: /diagram: cluster/i }) as unknown as SVGSVGElement
  svg.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: WORLD.width, bottom: WORLD.height, width: WORLD.width, height: WORLD.height, toJSON: () => ({}) }) as DOMRect
  return svg
}

const cameraOf = () => document.querySelector(".camera") as SVGGElement

test("zooming keeps the world point under the cursor still", () => {
  const box: Box = [0, 0, 1000, 640]
  const p: [number, number] = [300, 200]
  const out = zoomAt(box, p, 2)
  const k = WORLD.width / out[2]
  expect(out[2]).toBe(500)
  // the same world point (300, 200) sits under the cursor as before
  expect(out[0] + p[0] / k).toBeCloseTo(300)
  expect(out[1] + p[1] / k).toBeCloseTo(200)
})

test("the camera cannot leave the zoom range or the world", () => {
  expect(clampBox([0, 0, 100, 64])[2]).toBe(240)
  expect(clampBox([0, 0, 9_999, 6_400])[2]).toBe(1500)
  const far = clampBox([-5000, -5000, 1000, 640])
  expect(far[0] + far[2] / 2).toBeCloseTo(WORLD.width * -0.25)
})

test("panning moves the camera without zooming it", () => {
  const out = panBy([100, 50, 500, 320], 50, 0)
  expect(out[2]).toBe(500)
  // 50 viewBox units at scale 2 is 25 world units
  expect(out[0]).toBeCloseTo(75)
})

test("scrolling over the stage takes the camera and zooms it", () => {
  render(<App />)
  const svg = stage()
  const before = cameraOf().style.transform
  fireEvent.wheel(svg, { deltaY: -240, clientX: 300, clientY: 200 })
  expect(cameraOf().getAttribute("data-manual")).toBe("true")
  expect(cameraOf().style.transform).not.toBe(before)
  expect(screen.getByRole("button", { name: "Reset view" })).toBeTruthy()
})

test("Reset view hands the camera back to the lesson", () => {
  render(<App />)
  const svg = stage()
  const before = cameraOf().style.transform
  fireEvent.wheel(svg, { deltaY: -240, clientX: 300, clientY: 200 })
  fireEvent.click(screen.getByRole("button", { name: "Reset view" }))
  expect(cameraOf().getAttribute("data-manual")).toBe(null)
  expect(cameraOf().style.transform).toBe(before)
})

test("dragging pans the stage and leaves clicks on actors alone", () => {
  render(<App />)
  const svg = stage()
  const before = cameraOf().style.transform
  fireEvent.pointerDown(svg, { pointerId: 1, button: 0, clientX: 500, clientY: 320, bubbles: true })
  fireEvent.pointerMove(svg, { pointerId: 1, clientX: 620, clientY: 320, bubbles: true })
  fireEvent.pointerUp(svg, { pointerId: 1, bubbles: true })
  expect(cameraOf().getAttribute("data-manual")).toBe("true")
  expect(cameraOf().style.transform).not.toBe(before)
  expect(screen.queryByRole("button", { name: "Reset view" })).toBeTruthy()
})

test("one finger on a touch screen scrolls the page, not the stage", () => {
  render(<App />)
  const svg = stage()
  const before = cameraOf().style.transform
  fireEvent.pointerDown(svg, { pointerId: 1, pointerType: "touch", clientX: 500, clientY: 320, bubbles: true })
  fireEvent.pointerMove(svg, { pointerId: 1, pointerType: "touch", clientX: 500, clientY: 520, bubbles: true })
  fireEvent.pointerUp(svg, { pointerId: 1, bubbles: true })
  expect(cameraOf().getAttribute("data-manual")).toBe(null)
  expect(cameraOf().style.transform).toBe(before)
  expect(screen.queryByRole("button", { name: "Reset view" })).toBeNull()
})

test("two fingers on a touch screen pan and zoom the stage", () => {
  render(<App />)
  const svg = stage()
  const before = cameraOf().style.transform
  fireEvent.pointerDown(svg, { pointerId: 1, pointerType: "touch", clientX: 400, clientY: 300, bubbles: true })
  fireEvent.pointerDown(svg, { pointerId: 2, pointerType: "touch", clientX: 500, clientY: 300, bubbles: true })
  // fingers spread apart and the midpoint travels: zoom plus pan
  fireEvent.pointerMove(svg, { pointerId: 1, pointerType: "touch", clientX: 350, clientY: 300, bubbles: true })
  fireEvent.pointerMove(svg, { pointerId: 2, pointerType: "touch", clientX: 560, clientY: 300, bubbles: true })
  fireEvent.pointerUp(svg, { pointerId: 1, bubbles: true })
  fireEvent.pointerUp(svg, { pointerId: 2, bubbles: true })
  expect(cameraOf().getAttribute("data-manual")).toBe("true")
  expect(cameraOf().style.transform).not.toBe(before)
  expect(screen.queryByRole("button", { name: "Reset view" })).toBeTruthy()
})

test("a click without a drag still opens a node", async () => {
  const user = userEvent.setup()
  render(<App />)
  await user.click(screen.getByRole("button", { name: "Look inside node-1" }))
  expect(screen.getByRole("navigation", { name: "Zoom level" }).textContent).toContain("node-1")
})

test("drilling into a level takes the camera back from the reader", async () => {
  const user = userEvent.setup()
  render(<App />)
  fireEvent.wheel(stage(), { deltaY: -240, clientX: 300, clientY: 200 })
  await user.click(screen.getByRole("button", { name: "Look inside node-1" }))
  expect(cameraOf().getAttribute("data-manual")).toBe(null)
})

test("the zoom buttons steer the camera too", async () => {
  const user = userEvent.setup()
  render(<App />)
  const before = cameraOf().style.transform
  await user.click(screen.getByRole("button", { name: "Zoom in" }))
  await user.click(screen.getByRole("button", { name: "Zoom in" }))
  expect(cameraOf().getAttribute("data-manual")).toBe("true")
  expect(cameraOf().style.transform).not.toBe(before)
  await user.click(screen.getByRole("button", { name: "Zoom out" }))
  await user.click(screen.getByRole("button", { name: "Zoom out" }))
  expect(screen.queryByRole("button", { name: "Reset view" })).toBeTruthy()
})
