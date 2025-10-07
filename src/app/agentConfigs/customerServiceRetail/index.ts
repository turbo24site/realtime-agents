// src/app/agentConfigs/customerServiceRetail/index.ts

import { RealtimeAgent } from '@openai/agents/realtime';

// --- helpers ---
async function postJSON(url: string | undefined, payload: unknown) {
  if (!url) {
    return { ok: false, status: 500, error: 'Missing webhook URL env var' };
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let body: any = null;
  try { body = await res.json(); } catch { /* ignore */ }
  return { ok: res.ok, status: res.status, body };
}

// --- tool factories (same shape as above) ---
const subscribeToList = (_agent?: unknown) => ({
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
  },
  handler: async ({ name, email, profile }: any) => {
    const r = await postJSON(process.env.SUBSCRIBE_WEBHOOK, {
      name, email, profile, source: 'realtime-agent',
    });
    return r.ok ? { ok: true } : { ok: false, status: r.status, error: r['error'] || r['body'] };
  },
  execute: async (args: any) => {
    const { name, email, profile } = args || {};
    const r = await postJSON(process.env.SUBSCRIBE_WEBHOOK, {
      name, email, profile, source: 'realtime-agent',
    });
    return r.ok ? { ok: true } : { ok: false, status: r.status, error: r['error'] || r['body'] };
  },
} as any);

const createContactRequest = (_agent?: unknown) => ({
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
  },
  handler: async ({ name, email, topic }: any) => {
    const r = await postJSON(process.env.CONTACT_WEBHOOK, {
      name, email, topic, source: 'realtime-agent',
    });
    return r.ok ? { created: true } : { created: false, status: r.status, error: r['error'] || r['body'] };
  },
  execute: async (args: any) => {
    const { name, email, topic } = args || {};
    const r = await postJSON(process.env.CONTACT_WEBHOOK, {
      name, email, topic, source: 'realtime-agent',
    });
    return r.ok ? { created: true } : { created: false, status: r.status, error: r['error'] || r['body'] };
  },
} as any);

// --- agent config ---
const retailAgent = new RealtimeAgent({
  name: 'Sophie',
  voice: 'sage',
  instructions: `
You are a friendly customer-service agent for AssetsWaves.

SCOPE
• Handle FAQs about our platform, onboarding, supported jurisdictions, and high-level compliance for real-estate tokenization.
• Never provide financial advice or promise returns. If asked: “I’m not allowed to provide investment advice.”
• Offer newsletter signup and human follow-up when appropriate.

BEHAVIOR
• Short, clear, voice-first responses.
• Confirm names/emails by reading them back.
• If you are unsure or the topic is complex, offer to notify the team.

ACTIONS
• To add someone to the newsletter, call subscribe_to_list{name, email, profile}.
• For human follow-up, call create_contact_request{name, email, topic}.
  `.trim(),
  tools: [
    subscribeToList,
    createContactRequest,
  ] as any,
});

export const customerServiceRetailScenario = [retailAgent];
export const customerServiceRetailCompanyName = 'AssetsWaves';
export default customerServiceRetailScenario;
