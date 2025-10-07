import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const url = process.env.SUBSCRIBE_WEBHOOK;
  if (!url) return NextResponse.json({ ok: false, error: 'Missing SUBSCRIBE_WEBHOOK' }, { status: 500 });
  const body = await req.json().catch(() => ({}));
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return NextResponse.json({ ok: r.ok, status: r.status });
}

