import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@ui-sdk/react/dialog"
import { Button } from "@ui-sdk/react/button"
import { toggleFullscreen } from "../hooks"
import { Icon } from "./Icon"

const SHORTCUTS: [string, string][] = [
  ["Space", "Play, pause, or go to the next step"],
  ["← / →", "Previous or next step"],
  ["N", "Next: skip the pause, or carry on"],
  ["]", "Speed up (1×, 2×, 4×)"],
  ["E", "Show or hide the events"],
  ["S", "Cluster or sequence view"],
  ["+ / −", "Zoom the diagram (when it's focused)"],
  ["R", "Restart the lesson"],
  ["D", "Diagram only"],
  ["F", "Fullscreen"],
  ["?", "This list"],
]

export function ShortcutsDialog() {
  return (
    <Dialog>
      <DialogTrigger render={<Button />} shortcut="shift+?" className="ibtn ghost" aria-label="Keyboard shortcuts">
        <Icon name="keys" />
      </DialogTrigger>
      <DialogBackdrop className="backdrop" />
      <DialogContent className="dialog shortcuts">
        <div className="dialog-head">
          <DialogTitle className="dialog-title">Keyboard shortcuts</DialogTitle>
          <DialogClose className="ibtn ghost" aria-label="Close">
            <Icon name="close" />
          </DialogClose>
        </div>
        <dl className="shortcut-list">
          {SHORTCUTS.map(([keys, what]) => (
            <div key={keys}>
              <dt><kbd>{keys}</kbd></dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
        <div className="dialog-foot">
          <Button className="btn sm" onClick={toggleFullscreen}>
            <Icon name="full" size={13} />
            Fullscreen
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
