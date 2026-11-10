# Sauti — Swahili voice ledger with PayPal

A PayPal agent that speaks Swahili. A shopkeeper in Dar es Salaam says what a customer took: *"Mama Asha amechukua mchele wa 15,000."*
Sauti writes it in the shop's daftari, and keeps Mama Asha's **family wallet (pochi ya familia)** funded by her son in New York:

- When the wallet is empty or low, Sauti itself sends him a PayPal request to top it up.
- When he pays, PayPal's webhook credits the wallet, clears anything she owed, and the shopkeeper is told (in the app and on WhatsApp).
- Her next purchases are paid on the spot from the wallet, so the shop carries no credit risk and the family sees exactly what the money bought.
- Sauti also answers "who hasn't paid?", sends PayPal reminders, and advises on credit from the family's PayPal payment record.

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
- `app/page.tsx` — the app: mic + daftari (the shop's ruled credit book)
- `app/demo/page.tsx` — two-cities demo view: the shop's phone and the family's phone side by side
- `app/api/whatsapp` — WhatsApp voice notes and texts via Meta's WhatsApp Cloud API; replies and payment alerts go back on WhatsApp
- `lib/whatsapp.ts` — Meta signature check, voice-note download, sending messages
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
