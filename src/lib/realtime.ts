/**
 * Browser ↔ OpenAI Realtime API client.
 *
 * Flow:
 *   1. Mint an ephemeral client_secret via /api/realtime/session.
 *   2. Open a WebRTC peer connection to OpenAI.
 *   3. Audio streams both directions; text events flow over a data channel.
 *   4. When the model calls `query_company_data`, we forward to
 *      /api/realtime/tool, then send the result back via the data channel.
 *
 * The realtime session's instructions and tool definitions live server-side
 * (src/app/api/realtime/session/route.ts), so the browser never sees the
 * OpenAI API key.
 */

// GA WebRTC connection URL (replaces the beta `/v1/realtime?model=` endpoint).
const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls'

export type RealtimeStatus =
    | 'idle'
    | 'connecting'
    | 'live'
    | 'error'
    | 'closed'

export interface RealtimeEvents {
    onStatus?: (status: RealtimeStatus) => void
    onUserTranscript?: (text: string) => void
    onAssistantTranscript?: (text: string, done: boolean) => void
    onError?: (msg: string) => void
    /** Speaking state of the assistant (for waveform / live UI). */
    onAssistantAudioActivity?: (active: boolean) => void
}

export interface RealtimeSession {
    stop: () => void
}

export async function startRealtime(
    mode: 'admin' | 'employee',
    events: RealtimeEvents = {},
): Promise<RealtimeSession> {
    const setStatus = (s: RealtimeStatus) => events.onStatus?.(s)
    setStatus('connecting')

    // 1. Ephemeral session
    const sessionRes = await fetch('/api/realtime/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mode }),
    })
    const sessionData = await sessionRes.json().catch(() => null) as
        | { client_secret?: string; model?: string; error?: string }
        | null
    if (!sessionRes.ok || !sessionData?.client_secret) {
        const msg = sessionData?.error || `Session minting failed (${sessionRes.status})`
        events.onError?.(msg)
        setStatus('error')
        throw new Error(msg)
    }
    const ephemeralKey = sessionData.client_secret
    const model = sessionData.model || 'gpt-realtime-2'

    // 2. Peer connection
    const pc = new RTCPeerConnection()
    const remoteAudio = document.createElement('audio')
    remoteAudio.autoplay = true
    pc.ontrack = (e) => {
        remoteAudio.srcObject = e.streams[0]
    }

    // Track assistant audio activity (rough — based on remote stream presence).
    pc.addEventListener('track', () => events.onAssistantAudioActivity?.(true))

    // 3. Local audio (mic)
    let micStream: MediaStream
    try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Mic permission denied'
        events.onError?.(msg)
        setStatus('error')
        throw new Error(msg)
    }
    micStream.getTracks().forEach((t) => pc.addTrack(t, micStream))

    // 4. Data channel — JSON events both ways
    const dc = pc.createDataChannel('oai-events')

    let assistantBuffer = ''

    dc.onopen = () => setStatus('live')
    dc.onclose = () => setStatus('closed')
    dc.onerror = (e) => {
        events.onError?.(`Data channel error: ${(e as RTCErrorEvent).error?.message || ''}`)
        setStatus('error')
    }

    dc.onmessage = async (e) => {
        let evt: { type?: string;[k: string]: unknown } | null = null
        try { evt = JSON.parse(e.data) } catch { return }
        if (!evt?.type) return

        switch (evt.type) {
            // GA event names (renamed from response.audio_transcript.* in beta).
            case 'response.output_audio_transcript.delta':
                assistantBuffer += String(evt.delta || '')
                events.onAssistantTranscript?.(assistantBuffer, false)
                break
            case 'response.output_audio_transcript.done':
                events.onAssistantTranscript?.(assistantBuffer, true)
                assistantBuffer = ''
                break
            case 'conversation.item.input_audio_transcription.completed':
                events.onUserTranscript?.(String(evt.transcript || ''))
                break
            case 'response.function_call_arguments.done': {
                // Model called query_company_data — forward to our backend.
                const args = (() => {
                    try { return JSON.parse(String(evt.arguments || '{}')) }
                    catch { return {} as Record<string, unknown> }
                })()
                const callId = String(evt.call_id || '')
                const question = String(args.question || '').trim()
                let answer = '(no answer)'
                try {
                    const r = await fetch('/api/realtime/tool', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ mode, question }),
                    })
                    const data = await r.json().catch(() => null) as { answer?: string; error?: string } | null
                    answer = data?.answer || data?.error || '(no answer)'
                } catch (toolErr) {
                    answer = `Tool error: ${toolErr instanceof Error ? toolErr.message : 'unknown'}`
                }
                // Send the function output back to OpenAI.
                dc.send(JSON.stringify({
                    type: 'conversation.item.create',
                    item: {
                        type: 'function_call_output',
                        call_id: callId,
                        output: answer,
                    },
                }))
                // Ask the model to continue / speak the answer.
                dc.send(JSON.stringify({ type: 'response.create' }))
                break
            }
            case 'error':
                events.onError?.(String((evt as { error?: { message?: string } }).error?.message || 'Realtime error'))
                break
        }
    }

    // 5. SDP offer/answer with OpenAI
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    // GA: SDP exchange goes to /v1/realtime/calls. The model is bound to the
    // ephemeral key at mint time, so no `?model=` query param is needed and
    // the `OpenAI-Beta` header has been dropped.
    void model
    const sdpResp = await fetch(REALTIME_CALLS_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${ephemeralKey}`,
            'Content-Type': 'application/sdp',
        },
        body: offer.sdp,
    })
    if (!sdpResp.ok) {
        const txt = await sdpResp.text().catch(() => '')
        events.onError?.(`OpenAI SDP failed: ${txt || sdpResp.status}`)
        setStatus('error')
        try { pc.close() } catch { /* no-op */ }
        micStream.getTracks().forEach((t) => t.stop())
        throw new Error(`OpenAI SDP failed (${sdpResp.status})`)
    }
    const answerSdp = await sdpResp.text()
    await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })

    return {
        stop: () => {
            try { dc.close() } catch { /* no-op */ }
            try { pc.close() } catch { /* no-op */ }
            micStream.getTracks().forEach((t) => t.stop())
            remoteAudio.srcObject = null
            setStatus('closed')
        },
    }
}
