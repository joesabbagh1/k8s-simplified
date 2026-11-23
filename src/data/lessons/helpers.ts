import type { ClusterEvent, DecodedSection, FrameLayer } from "../types"

export const sec = (title: string, fields: [key: string, value: string, changed?: boolean][]): DecodedSection => ({
  title,
  fields: fields.map(([key, value, changed]) => ({ key, value, changed })),
})

export const ev = (e: ClusterEvent) => e

export const layer = (name: string, detail: string, bytes: number, inner = false): FrameLayer => ({ name, detail, bytes, inner })
