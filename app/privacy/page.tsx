import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy: Sauti" };

// Set CONTACT_EMAIL in the environment to show a contact address for deletion requests.
const CONTACT = process.env.CONTACT_EMAIL;
export const dynamic = "force-dynamic";

// Privacy policy and data-deletion instructions (Meta requires a URL for each to publish the app).
export default function Privacy() {
  return (
    <main className="min-h-dvh bg-paper px-5 py-10 text-foreground sm:px-10">
      <article className="mx-auto max-w-[40rem] space-y-5 leading-relaxed">
        <Link href="/" className="text-sm text-muted-foreground underline underline-offset-4">
          Back to Sauti
        </Link>
        <h1 className="text-3xl font-bold text-ink">Privacy policy</h1>
        <p className="text-sm text-muted-foreground">Last updated 9 November 2026</p>

        <p>
          Sauti is a hackathon demo of a Swahili voice ledger for small shops. It runs on test accounts (PayPal sandbox and a
          WhatsApp test number) and handles no real money.
        </p>

        <h2 className="pt-2 text-xl font-semibold text-ink">What Sauti collects</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Messages and voice notes you send to Sauti in the app or on WhatsApp.</li>
          <li>Your WhatsApp number, so Sauti can reply and send payment alerts.</li>
          <li>Ledger entries Sauti writes from what you say: names, items and amounts.</li>
        </ul>

        <h2 className="pt-2 text-xl font-semibold text-ink">How it's used</h2>
        <p>
          Only to run the ledger: voice notes are turned into text by ElevenLabs, the text is read by Claude (Anthropic) to
          record entries and prepare invoices, and invoices are created in PayPal's sandbox. Sauti does not sell or share your
          data for any other purpose, and does not use it for advertising.
        </p>

        <h2 className="pt-2 text-xl font-semibold text-ink">How long it's kept</h2>
        <p>
          The demo keeps data in short-lived files on its server, which are erased whenever the app restarts or is redeployed,
          and conversation memory is forgotten after 30 minutes of inactivity.
        </p>

        <h2 id="data-deletion" className="pt-2 text-xl font-semibold text-ink">
          Deleting your data
        </h2>
        <p>
          To have everything Sauti holds about you deleted, contact the developer
          {CONTACT ? (
            <>
              {" "}at{" "}
              <a href={`mailto:${CONTACT}`} className="underline underline-offset-4">
                {CONTACT}
              </a>
            </>
          ) : (
            " through the project's GitHub page"
          )}{" "}
          with the WhatsApp number you used. It will be deleted within 7 days. Data is also erased automatically whenever the
          demo restarts.
        </p>
      </article>
    </main>
  );
}
