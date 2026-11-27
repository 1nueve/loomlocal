import type { BubbleShape } from './types'

export const BUBBLE_MIN_WIDTH = 120

/** Height / width. The rectangle is vertical 9:16. */
export function bubbleAspect(shape: BubbleShape): number {
  return shape === 'rect' ? 16 / 9 : 1
}

export interface Area {
  width: number
  height: number
}

/** Clamps a requested width to sensible limits for the given screen area. */
export function clampBubbleWidth(width: number, shape: BubbleShape, area: Area): number {
  const aspect = bubbleAspect(shape)
  const max = Math.max(BUBBLE_MIN_WIDTH, Math.min(area.width * 0.6, (area.height * 0.85) / aspect))
  return Math.round(Math.min(max, Math.max(BUBBLE_MIN_WIDTH, Number.isFinite(width) ? width : BUBBLE_MIN_WIDTH)))
}

export function bubbleSize(width: number, shape: BubbleShape, area: Area): { width: number; height: number } {
  const w = clampBubbleWidth(width, shape, area)
  return { width: w, height: Math.round(w * bubbleAspect(shape)) }
}

/** New bounds of the same size class, keeping the bottom-left corner fixed. */
export function anchorBottomLeft(
  current: { x: number; y: number; width: number; height: number },
  size: { width: number; height: number }
): { x: number; y: number; width: number; height: number } {
  return { x: current.x, y: current.y + current.height - size.height, width: size.width, height: size.height }
}
