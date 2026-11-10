'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export const MIN_ZOOM = 0.4
export const MAX_ZOOM = 1.6
const ZOOM_STEP = 0.15
const PAN_THRESHOLD = 5

/**
 * Grab-to-pan + zoom for the org chart canvas, shared by the admin and employee
 * views so both behave identically. Drag anywhere on the viewport to move the
 * chart; a small movement threshold keeps plain clicks working and a real drag
 * swallows the trailing click. Pass `ignoreTarget` to opt specific elements out
 * of panning (e.g. node cards owned by dnd-kit in the admin edit mode).
 */
export function useChartPan(ignoreTarget?: (el: HTMLElement) => boolean) {
    const [zoom, setZoom] = useState(1)
    const [pan, setPan] = useState({ x: 0, y: 0 })
    const panState = useRef<{ active: boolean; moved: boolean; startX: number; startY: number; baseX: number; baseY: number; pointerId: number }>({
        active: false, moved: false, startX: 0, startY: 0, baseX: 0, baseY: 0, pointerId: -1,
    })
    // True for the instant after a pan ends, so the resulting click is swallowed.
    const justPanned = useRef(false)

    const zoomIn = useCallback(() => setZoom(z => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2))), [])
    const zoomOut = useCallback(() => setZoom(z => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2))), [])
    const zoomReset = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [])

    const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return
        if (ignoreTarget && ignoreTarget(e.target as HTMLElement)) return
        panState.current = {
            active: true,
            moved: false,
            startX: e.clientX,
            startY: e.clientY,
            baseX: pan.x,
            baseY: pan.y,
            pointerId: e.pointerId,
        }
    }, [pan, ignoreTarget])

    const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        const st = panState.current
        if (!st.active) return
        const dx = e.clientX - st.startX
        const dy = e.clientY - st.startY
        if (!st.moved) {
            if (Math.hypot(dx, dy) < PAN_THRESHOLD) return
            st.moved = true
            try { e.currentTarget.setPointerCapture(st.pointerId) } catch { /* ignore */ }
            e.currentTarget.style.cursor = 'grabbing'
        }
        setPan({ x: st.baseX + dx, y: st.baseY + dy })
    }, [])

    const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        const st = panState.current
        if (!st.active) return
        if (st.moved) {
            justPanned.current = true
            try { e.currentTarget.releasePointerCapture(st.pointerId) } catch { /* ignore */ }
            e.currentTarget.style.cursor = ''
        }
        st.active = false
        st.moved = false
    }, [])

    const onClickCapture = useCallback((e: React.MouseEvent) => {
        if (justPanned.current) {
            justPanned.current = false
            e.preventDefault()
            e.stopPropagation()
        }
    }, [])

    return {
        zoom,
        pan,
        zoomIn,
        zoomOut,
        zoomReset,
        handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onClickCapture },
    }
}

// Never collapse the canvas below this, even on very short screens.
const MIN_CANVAS_HEIGHT = 320
// Room left under the canvas for the legend row + the page's bottom padding.
const CANVAS_BOTTOM_GAP = 72
// The chart wrapper sits `top-4` inside the canvas.
const CANVAS_TOP_INSET = 16

/**
 * Sizes the org-chart canvas so it follows the screen instead of a fixed box:
 * the viewport grows with the tree up to whatever height is left below it in
 * the window, and anything taller/wider scrolls (the caller sets `overflow-auto`).
 * Also returns the horizontal offset that keeps a narrow chart centred while
 * letting a wide one start at the left edge, so every column stays reachable by
 * scrolling instead of overflowing off the unscrollable left side.
 *
 * Both refs are callback refs so measuring starts as soon as the elements mount
 * (the chart only renders once its data has loaded).
 */
export function useChartCanvas(zoom: number) {
    const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null)
    const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null)
    const viewportRef = useCallback((el: HTMLDivElement | null) => setViewportEl(el), [])
    const contentRef = useCallback((el: HTMLDivElement | null) => setContentEl(el), [])
    const [content, setContent] = useState({ width: 0, height: 0 })
    const [viewportWidth, setViewportWidth] = useState(0)
    const [availableHeight, setAvailableHeight] = useState(MIN_CANVAS_HEIGHT)

    // Natural (unscaled) size of the tree. offsetWidth/offsetHeight report the
    // layout box, so the scale transform doesn't skew the measurement.
    useEffect(() => {
        if (!contentEl) return
        const measure = () => setContent(prev => (
            prev.width === contentEl.offsetWidth && prev.height === contentEl.offsetHeight
                ? prev
                : { width: contentEl.offsetWidth, height: contentEl.offsetHeight }
        ))
        measure()
        if (typeof ResizeObserver === 'undefined') return
        const ro = new ResizeObserver(measure)
        ro.observe(contentEl)
        return () => ro.disconnect()
    }, [contentEl])

    // How much room is left between the top of the canvas and the bottom of the
    // window. Measured from the document top so page scroll can't skew it.
    useEffect(() => {
        if (!viewportEl) return
        const measure = () => {
            const top = viewportEl.getBoundingClientRect().top + window.scrollY
            setAvailableHeight(Math.max(MIN_CANVAS_HEIGHT, window.innerHeight - top - CANVAS_BOTTOM_GAP))
            setViewportWidth(viewportEl.clientWidth)
        }
        measure()
        window.addEventListener('resize', measure)
        // Catches sidebar/filter-bar reflows that move or resize the canvas
        // without a window resize.
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
        ro?.observe(viewportEl)
        return () => {
            window.removeEventListener('resize', measure)
            ro?.disconnect()
        }
    }, [viewportEl])

    const scaledWidth = content.width * zoom
    const scaledHeight = content.height * zoom

    return {
        viewportRef,
        contentRef,
        // Shrink to the chart when it's small, stretch to the screen when it isn't.
        canvasHeight: Math.min(availableHeight, Math.max(MIN_CANVAS_HEIGHT, scaledHeight + CANVAS_TOP_INSET)),
        offsetX: Math.max(0, (viewportWidth - scaledWidth) / 2),
    }
}
