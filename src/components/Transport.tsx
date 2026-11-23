import { Button } from "@ui-sdk/react/button"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@ui-sdk/react/popover"
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control"
import { Toolbar, ToolbarButton } from "@ui-sdk/react/toolbar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@ui-sdk/react/tooltip"
import type { ReactElement } from "react"
import { timeline } from "../playback"
import { SPEEDS, useApp, useLesson, type PauseAfter } from "../store"
import { Icon, type IconName } from "./Icon"

const PAUSES: { value: PauseAfter; label: string; hint: string }[] = [
  { value: "none", label: "Never", hint: "Plays straight through to the summary" },
  { value: "step", label: "Step", hint: "Stops after every step" },
  { value: "event", label: "Event", hint: "Stops after every event: press Next to see the next one" },
]

function Settings() {
  const speed = useApp((s) => s.speed)
  const pauseAfter = useApp((s) => s.pauseAfter)
  const s = useApp.getState

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger render={<PopoverTrigger render={<ToolbarButton /> as ReactElement} />} className="ibtn ghost" aria-label="Playback settings" data-fast={speed > 1 || undefined}>
          <Icon name="sliders" />
          {speed > 1 && <span className="speed-tag">{speed}×</span>}
        </TooltipTrigger>
        <TooltipContent className="tip">Playback settings</TooltipContent>
      </Tooltip>
      <PopoverContent className="popover settings" side="top" sideOffset={10}>
        <PopoverTitle className="sr-only">Pause and speed</PopoverTitle>
        <div className="setting">
          <span>Pause after</span>
          <SegmentedControl aria-label="Pause after" className="seg" value={pauseAfter} onValueChange={(v) => v && s().setPauseAfter(v as PauseAfter)}>
            <SegmentedControlIndicator className="seg-indicator" />
            {PAUSES.map((p) => (
              <SegmentedControlItem key={p.value} value={p.value} title={p.hint}>{p.label}</SegmentedControlItem>
            ))}
          </SegmentedControl>
        </div>
        <div className="setting">
          <span>Speed <kbd>]</kbd></span>
          <SegmentedControl aria-label="Speed" className="seg" value={String(speed)} onValueChange={(v) => v && s().setSpeed(Number(v))}>
            <SegmentedControlIndicator className="seg-indicator" />
            {SPEEDS.map((x) => (
              <SegmentedControlItem key={x} value={String(x)}>{x}×</SegmentedControlItem>
            ))}
          </SegmentedControl>
        </div>
        <Button className="btn sm restart" onClick={() => s().restart()}>
          <Icon name="replay" size={12} />
          Restart lesson <kbd>R</kbd>
        </Button>
      </PopoverContent>
    </Popover>
  )
}

/** Play, step back and settings, centered under the diagram like a video player. */
export function Transport() {
  const lesson = useLesson()
  const mode = useApp((s) => s.mode)
  const step = useApp((s) => s.step)
  const revealed = useApp((s) => s.revealed)
  const finished = useApp((s) => s.finished)
  const pauseAfter = useApp((s) => s.pauseAfter)
  const s = useApp.getState
  const t = timeline(lesson)
  const playing = mode === "play"
  const stepDone = step >= 0 && revealed >= (t.end[step] ?? 0)
  const midStep = step >= 0 && revealed > t.start[step] && !stepDone
  const last = step >= lesson.steps.length - 1

  const [icon, label]: [IconName, string] = playing
    ? ["pause", "Pause"]
    : finished
      ? ["replay", "Replay"]
      : stepDone && !last
        ? ["next", "Next step"]
        : stepDone && last
          ? ["right", "Summary"]
          : midStep && pauseAfter === "event"
            ? ["right", "Next event"]
            : ["play", step < 0 ? "Play" : "Continue"]

  return (
    <Toolbar aria-label="Playback" className="transport">
      <Tooltip>
        <TooltipTrigger render={<ToolbarButton onClick={() => s().prevStep()} disabled={step < 0} /> as ReactElement} className="ibtn ghost" aria-label="Previous step">
          <Icon name="prev" />
        </TooltipTrigger>
        <TooltipContent className="tip">Previous step <kbd>←</kbd></TooltipContent>
      </Tooltip>
      <ToolbarButton render={<Button />} className="btn primary play" data-attention={(stepDone || midStep) && !playing && !finished ? "" : undefined} onClick={() => s().togglePlay()}>
        <Icon name={icon} size={12} />
        {label}
      </ToolbarButton>
      <Settings />
    </Toolbar>
  )
}
