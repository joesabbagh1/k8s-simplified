import { layerStyle } from "../data/layers"
import { sentence } from "../data/text"
import type { ClusterEvent, DecodedField, FrameLayer } from "../data/types"

const seconds = (ms: number) => `${(ms / 1000).toFixed(3)}s`

export function Frame({ layers }: { layers: FrameLayer[] }) {
  const total = layers.reduce((n, l) => n + l.bytes, 0)
  const outer = layers.filter((l) => !l.inner)
  const inner = layers.filter((l) => l.inner)
  const block = (l: FrameLayer, i: number) => (
    <div key={`${l.name}-${i}`} className="fl" style={{ flexGrow: l.bytes }} title={`${l.name} · ${l.detail} · ${l.bytes} bytes`}>
      <b>{l.name}</b>
      <span>{l.detail}</span>
      <i>{l.bytes} B</i>
    </div>
  )
  return (
    <figure className="frame" aria-label={`Packet, ${total} bytes of headers`}>
      <div className="frame-row">
        {outer.map(block)}
        {inner.length > 0 && (
          <div className="frame-inner" style={{ flexGrow: inner.reduce((n, l) => n + l.bytes, 0) }}>
            <em>original packet</em>
            <div className="frame-row">{inner.map(block)}</div>
          </div>
        )}
      </div>
      <figcaption>{inner.length ? `${outer.reduce((n, l) => n + l.bytes, 0)} bytes of wrapping around the original packet` : `${total} bytes of headers`}</figcaption>
    </figure>
  )
}

export function Fields({ fields }: { fields: DecodedField[] }) {
  return (
    <dl>
      {fields.map((f) => (
        <div key={f.key} className="kv" data-changed={f.changed || undefined}>
          <dt>{f.key}</dt>
          <dd>
            {f.value}
            {f.changed && <em>CHANGED</em>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function Decoder({ event, index }: { event: ClusterEvent; index: number }) {
  return (
    <div className="decoder" aria-label="Decoded event">
      <div className="dh">
        <span className="badge" style={layerStyle(event)}>{index + 1}</span>
        <div>
          <b>{sentence(event.title)}</b>
          <small>{event.src} → {event.dst} · {seconds(event.at)}</small>
        </div>
      </div>
      {event.frame && <Frame layers={event.frame} />}
      {event.decoded.map((section) => (
        <details key={section.title} open>
          <summary>{sentence(section.title)}</summary>
          <Fields fields={section.fields} />
        </details>
      ))}
      {event.note && <p className="note">{event.note}</p>}
    </div>
  )
}
