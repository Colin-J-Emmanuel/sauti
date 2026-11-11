export type Entry = {
  id: string;
  createdAt: string;
  type: "credit_sale" | "payment_received" | "cash_sale" | "expense" | "wallet_topup" | "wallet_sale";
  counterparty: string;
  item?: string;
  amount: number;
  currency: "TZS" | "USD";
  note?: string;
  paypalInvoiceId?: string;
  paidAt?: string;
  fromCredit?: boolean;
};

export type Notice = {
  invoiceId: string;
  customer: string;
  payer?: string;
  amountTzs: number;
  at: string;
  kind?: "bill" | "topup";
  clearedTzs?: number;
};

export type Topup = { invoiceId: string; customer: string; amountTzs: number; usd: number; createdAt: string; paidAt?: string };

export type Customer = { name: string; payer: { name: string; relation: string; city: string } | null };

export type LedgerData = {
  entries: Entry[];
  balances: Record<string, Record<string, number>>;
  wallets: Record<string, number>;
  topups: Topup[];
  walletLowTzs: number;
  notices: Notice[];
  customers: Customer[];
  activity: Activity | null;
  whatsapp: ChatMessage[];
  tzsPerUsd: number;
};

export type AgentAction = { tool: string; args: any; result: any };
export type Activity = { at: string; source: "app" | "whatsapp"; said: string; spoken: boolean; reply: string; actions: AgentAction[] };
export type AgentResponse = { reply?: string; actions?: AgentAction[]; transcript?: string; error?: string };

export type ChatMessage = {
  id: string;
  at: string;
  from: "shop" | "sauti";
  kind: "text" | "voice" | "ack" | "reply" | "alert";
  text?: string;
  transcript?: string;
  audio?: string;
};
