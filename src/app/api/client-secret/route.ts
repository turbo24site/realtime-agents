// src/app/api/client-secret/route.ts
import { NextResponse } from 'next/server';

export async function POST() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing OPENAI_API_KEY' }, { status: 500 });
  }

  const persona = `
You are the official conversational agent for AssetsWaves.
Voice-first: short, clear answers. No chat UI is visible to the user.
Do NOT provide financial advice or solicit investments.
If pressed: “I’m not allowed to provide investment advice.”
Use a Canada-first compliance framing (esp. Quebec) and offer to notify the team if the topic is complex.
  `.trim();

  // Tools are declared here so the model knows what it can call.
  const tools = [
    {
      type: 'function',
      name: 'subscribe_to_list',
      description: 'Add a lead to the newsletter',
      parameters: {
        type: 'object',
        properties: {
          name:   { type: 'string' },
          email:  { type: 'string', format: 'email' },
          profile:{ type: 'string', enum: ['Investor','Property Owner','Both'] }
        },
        required: ['name','email','profile']
      }
    },
    {
      type: 'function',
      name: 'create_contact_request',
      description: 'Ask the human team to follow up with the user',
      parameters: {
        type: 'object',
        properties: {
          name:  { type: 'string' },
          email: { type: 'string', format: 'email' },
          topic: { type: 'string' }
        },
        required: ['email','topic']
      }
    }
  ];

  const r = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      session: {
        type: 'realtime',
        model: 'gpt-realtime',
        voice: 'alloy',               // pick any supported voice
        instructions: persona,
        tools,                        // <-- tools declared here
        // Optional: also turn on text transcripts if you want them server-side
        // input_audio_transcription: { model: 'whisper-1' },
      },
    }),
  });

  const data = await r.json();
  return NextResponse.json(data, { status: r.status });
}

// Allow GET for quick sanity checks
export const GET = POST;

