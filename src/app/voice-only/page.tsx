// src/app/voice-only/page.tsx
'use client';

import React, { useRef, useState } from 'react';

type AnyEvent = Record<string, any>;

export default function VoiceOnlyPage() {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const eventDcRef = useRef<RTCDataChannel | null>(null);

  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Your webhooks (set as Vercel env vars; we read them via /api because client can't see server env)
  // We’ll fetch them from a tiny helper endpoint or you can hardcode NEXT_PUBLIC_ vars.
  const SUBSCRIBE_WEBHOOK = process.env.NEXT_PUBLIC_SUBSCRIBE_WEBHOOK || '/api/relay/subscribe';
  const CONTACT_WEBHOOK   = process.env.NEXT_PUBLIC_CONTACT_WEBHOOK   || '/api/relay/contact';

  async function startSession() {
    setError(null);
    setConnecting(true);

    try {
      // 1) Prepare RTCPeerConnection
      const pc = new RTCPeerConnection({ iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }] });
      pcRef.current = pc;

      // 2) Remote audio sink
      pc.ontrack = (ev) => {
        const [remoteStream] = ev.streams;
        if (audioElRef.current) {
          audioElRef.current.srcObject = remoteStream;
          audioElRef.current.play().catch(() => {/* autoplay needs user gesture sometimes */});
        }
      };

      // 3) Local mic
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = mic;
      mic.getTracks().forEach((t) => pc.addTrack(t, mic));

      // 4) Data channel for events (tool calls, etc.)
      const outDc = pc.createDataChannel('oai-events');
      eventDcRef.current = outDc;

      outDc.onopen = () => {
        // We can send/receive JSON events with the Realtime model
        // console.log('events channel open');
      };

      // The model may also create its own channel; listen for it too.
      pc.ondatachannel = (e) => {
        const ch = e.channel;
        if (!eventDcRef.current) eventDcRef.current = ch;
        ch.onmessage = (m) => handleIncomingEvent(m);
      };

      // 5) Create local offer
      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);

      // 6) Get a short-lived client secret from our server
      const secretRes = await fetch('/api/client-secret', { method: 'POST' });
      if (!secretRes.ok) throw new Error('Failed to get client secret');
      const { client_secret } = await secretRes.json();
      if (!client_secret) throw new Error('No client_secret returned');

      // 7) Send SDP offer to OpenAI Realtime; receive SDP answer
      const sdpRes = await fetch('https://api.openai.com/v1/realtime?model=gpt-realtime', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${client_secret}`,
          'Content-Type': 'application/sdp',
        },
        body: offer.sdp,
      });

      const answer = await sdpRes.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answer });

      setConnected(true);
    } catch (err: any) {
      console.error(err);
      setError(err?.message ?? 'Unknown error');
      await stopSession();
    } finally {
      setConnecting(false);
    }
  }

  async function stopSession() {
    setConnected(false);
    setConnecting(false);

    try {
      if (pcRef.current) {
        pcRef.current.getSenders().forEach((s) => s.track && s.track.stop());
        pcRef.current.close();
      }
      pcRef.current = null;

      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      micStreamRef.current = null;

      if (eventDcRef.current) {
        eventDcRef.current.close();
      }
      eventDcRef.current = null;
    } catch {
      // ignore
    }
  }

  // --- Tool plumbing ---

  // Best-effort parser for tool calls coming over the Realtime data channel
  async function handleIncomingEvent(msg: MessageEvent) {
    try {
      const payloadText = await (async () => {
        if (typeof msg.data === 'string') return msg.data;
        if (msg.data instanceof Blob) return await msg.data.text();
        return '';
      })();

      if (!payloadText) return;

      const evt: AnyEvent = JSON.parse(payloadText);

      // Heuristic: accept several possible shapes for tool calls
      const call =
        evt?.tool_call ||
        evt?.function_call ||
        evt?.data?.tool_call ||
        (evt?.type && evt?.type.toString().includes('tool') ? evt : null);

      if (!call) return;

      const name =
        call.name || evt.name || evt.tool?.name || evt?.function?.name || evt?.tool_name;

      const callId =
        call.id || evt.call_id || evt.tool_call_id || evt?.id || `call_${Date.now()}`;

      // Arguments may arrive as object or JSON string or char-stream deltas;
      // we try our best to reconstruct a usable object.
      let args: any = call.arguments ?? evt.arguments ?? evt?.tool?.arguments;
      if (typeof args === 'string') {
        try { args = JSON.parse(args); } catch { /* leave as string */ }
      }

      if (name === 'subscribe_to_list') {
        const ok = await webhook(SUBSCRIBE_WEBHOOK, {
          name: args?.name,
          email: args?.email,
          profile: args?.profile,
          source: 'realtime-agent',
        });
        return sendToolResult(callId, name, { ok });
      }

      if (name === 'create_contact_request') {
        const ok = await webhook(CONTACT_WEBHOOK, {
          name: args?.name,
          email: args?.email,
          topic: args?.topic,
          source: 'realtime-agent',
        });
        return sendToolResult(callId, name, { created: ok });
      }

      // Not our tool → ignore
    } catch (e) {
      console.warn('event parse error', e);
    }
  }

  async function webhook(url: string, body: any) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  function sendToolResult(callId: string, name: string, result: any) {
    const ch = eventDcRef.current;
    if (!ch || ch.readyState !== 'open') return;

    // Generic tool-result event back to the model
    const payload = {
      type: 'tool_result',
      tool_call_id: callId,
      name,
      content_type: 'application/json',
      result,
    };
    try { ch.send(JSON.stringify(payload)); } catch { /* ignore */ }
  }

  // --- UI ---

  return (
    <div style={styles.page}>
      <audio ref={audioElRef} autoPlay playsInline style={{ display: 'none' }} />

      <div style={styles.card}>
        <h1 style={styles.title}>AssetsWaves Voice Agent</h1>
        <p style={styles.sub}>Tap to talk. Voice only. No chat.</p>

        <button
          onClick={connected ? stopSession : startSession}
          disabled={connecting}
          style={{
            ...styles.micButton,
            background: connected ? '#ef4444' : '#ca3dc9',
          }}
          aria-label={connected ? 'Stop talking' : 'Start talking'}
          title={connected ? 'Stop' : 'Talk'}
        >
          {connected ? '■ Stop' : '🎙️ Talk'}
        </button>

        {connecting && <p style={styles.note}>Connecting… allow microphone if prompted.</p>}
        {connected && <p style={styles.note}>Listening… just speak normally.</p>}
        {error && <p style={styles.err}>Error: {error}</p>}

        <div style={styles.foot}>
          <small>Compliance-first. No financial advice.</small>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100svh',
    display: 'grid',
    placeItems: 'center',
    background: '#0b0b0f',
    padding: 16,
  },
  card: {
    width: 'min(520px, 92vw)',
    background: '#12121a',
    borderRadius: 16,
    padding: 24,
    boxShadow: '0 12px 40px rgba(0,0,0,.35)',
    textAlign: 'center',
    color: '#e6e6f0',
  },
  title: { margin: 0, fontSize: 24, fontWeight: 800 },
  sub: { opacity: 0.8 },
  micButton: {
    marginTop: 18,
    border: 'none',
    color: '#fff',
    fontWeight: 700,
    fontSize: 18,
    width: 220,
    height: 220,
    borderRadius: '110px',
    cursor: 'pointer',
    boxShadow: '0 14px 40px rgba(0,0,0,.3)',
  },
  note: { marginTop: 12, opacity: 0.8 },
  err: { marginTop: 12, color: '#ff6b6b' },
  foot: { marginTop: 24, opacity: 0.6 },
};

