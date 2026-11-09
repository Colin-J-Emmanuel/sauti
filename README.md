# Sauti — Swahili voice ledger with PayPal

A shopkeeper in Dar es Salaam speaks in Swahili: *"Mama Asha amechukua mchele wa 15,000 kwa mkopo… tuma bili kwa mwanawe Marekani."*
Sauti records it in the shop's ledger (TZS) and sends a PayPal invoice in USD to Mama Asha's son in New York, who pays the shop directly.
Diaspora money goes straight to the family's groceries instead of through a remittance; the shop withdraws to M-Pesa (PayPal × M-Pesa, Tanzania 2026).

**Stack:** Next.js 15 · Vercel AI SDK · ElevenLabs Scribe (Swahili speech-to-text) · Claude Haiku (agent + tool calling, with fallback) · PayPal Agent Toolkit (sandbox, invoices) · PayPal Webhooks · Render.

**The loop:** speak → ledger entry (TZS) → agent creates + sends a USD PayPal invoice to the relative abroad → relative pays → PayPal webhook `INVOICING.INVOICE.PAID` → tab marked paid and the shop is told, out loud, in Swahili.

## Setup

```bash
npm install
cp .env.example .env    # fill in PayPal sandbox, Anthropic and ElevenLabs keys
```

In `data/contacts.json`, each customer can have a `payer` (the relative abroad). Replace `REPLACE_WITH_SANDBOX_PERSONAL_EMAIL` with your **sandbox personal account** email (developer.paypal.com → Testing Tools → Sandbox Accounts) so you can log in as "Juma" and pay the invoice in the demo.

## Run

```bash
npm run test:agent                 # full demo sequence → real sandbox invoice to Juma
npm run test:agent -- "Baraka amelipa 5,000"
npm run dev                        # UI at http://localhost:3000
```

## Layout

- `lib/agent.ts` — system prompt, ledger tools, PayPal tools, model fallback
- `lib/models.ts` — which models to use (from `.env`), ElevenLabs transcription
- `lib/ledger.ts` — JSON-file ledger, balances, family tab (unbilled items + payer abroad)
- `data/contacts.json` — customers and the relatives who pay their tabs
- `app/api/agent` — POST `audio` or `text`
- `app/api/paypal/webhook` — verifies PayPal signatures, ignores retried duplicates, settles paid invoices, un-bills cancelled ones
- `lib/paypal.ts` — OAuth token (cached, refreshed before expiry) + webhook signature verification
- `app/page.tsx` — record button, ledger, live "payment received" banner
- `render.yaml` — one-click deploy on Render

The ledger keeps shillings; invoices go out in USD (the payer's currency) at `TZS_PER_USD`.

## Test the webhook locally (no PayPal needed)

```bash
SKIP_WEBHOOK_VERIFY=true npm run dev
curl -X POST localhost:3000/api/paypal/webhook -H 'Content-Type: application/json' \
  -d '{"id":"WH-1","event_type":"INVOICING.INVOICE.PAID","resource":{"id":"<an invoice id from your ledger>"}}'
```

## License

MIT
