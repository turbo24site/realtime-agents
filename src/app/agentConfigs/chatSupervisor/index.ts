// src/app/agentConfigs/chatSupervisor/index.ts

import { RealtimeAgent } from '@openai/agents/realtime';
import { getNextResponseFromSupervisor } from './supervisorAgent';

/**
 * Chat agent used in the "chatSupervisor" scenario.
 * - Voice-first, short replies, strict on no financial advice.
 * - Collects name + email + role (Investor / Property Owner / Both).
 * - Offers human handoff when appropriate.
 * - Canada-first compliance tone (esp. Quebec). Jurisdictions vary.
 * - Adds two tools: subscribe_to_list, create_contact_request (uses Vercel env vars).
 */

// ---------- helper ----------
async function postJSON(url: string | undefined, payload: unknown) {
  if (!url) return { ok: false, status: 500, error: 'Missing webhook URL env var' };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let body: any = null;
  try { body = await res.json(); } catch { /* noop */ }
  return { ok: res.ok, status: res.status, body };
}

// ---------- tool registrars ----------
function subscribeToList(agent: RealtimeAgent) {
  agent.addTool(
    {
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
    async ({ name, email, profile }) => {
      const payload = { name, email, profile, source: 'realtime-agent' };
      const r = await postJSON(process.env.SUBSCRIBE_WEBHOOK, payload);
      return r.ok ? { ok: true } : { ok: false, status: r.status, error: r['error'] || r['body'] };
    }
  );
}

function createContactRequest(agent: RealtimeAgent) {
  agent.addTool(
    {
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
    },
    async (payload) => {
      const r = await postJSON(process.env.CONTACT_WEBHOOK, { ...payload, source: 'realtime-agent' });
      return r.ok ? { created: true } : { created: false, status: r.status, error: r['error'] || r['body'] };
    }
  );
}

// ---------- agent ----------
const chatAgent = new RealtimeAgent({
  name: 'Sophie',
  voice: 'sage',
  instructions: `
You are the official conversational agent for AssetsWaves.

GOALS
• Explain real-estate tokenization clearly: what it is, how it works end-to-end, pros/cons, and high-level compliance.
• Do NOT provide financial advice or solicit investments. If pressed: “I’m not allowed to provide investment advice.”
• Offer to add the user to our newsletter. Collect: name, email, role (Investor / Property Owner / Both).
• If a human is requested: say “I’ll notify the team” and take name, email, topic.
• Voice-first: short sentences, confirm names/emails by spelling or reading back.

COMPLIANCE TONE
• Canada-first framing (especially Quebec). Regulations vary by jurisdiction.
• Encourage users to consult professionals for legal/tax/financial specifics.

INTERACTION STYLE
• Warm, concise, helpful. Avoid jargon; define terms briefly on first use.
• If unsure: ask a brief clarifying question or offer human follow-up.
  `.trim(),
  tools: [
    // Existing supervisor escalation
    getNextResponseFromSupervisor,

    // New tools
    subscribeToList,
    createContactRequest,
  ],
});

export const chatSupervisorScenario = [chatAgent];

// Name used by guardrails/CX copy
export const chatSupervisorCompanyName = 'AssetsWaves';

export default chatSupervisorScenario;
