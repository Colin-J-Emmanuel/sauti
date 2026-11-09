export type Entry = {
  id: string;
  createdAt: string;
  type: "credit_sale" | "payment_received" | "cash_sale" | "expense";
  counterparty: string;
  item?: string;
  amount: number;
  currency: "TZS" | "USD";
  note?: string;
  paypalInvoiceId?: string;
  paidAt?: string;
};

export type Notice = { invoiceId: string; customer: string; payer?: string; amountTzs: number; at: string };

export type Customer = { name: string; payer: { name: string; relation: string; city: string } | null };

export type LedgerData = {
  entries: Entry[];
  balances: Record<string, Record<string, number>>;
  notices: Notice[];
  customers: Customer[];
  tzsPerUsd: number;
};

export type AgentAction = { tool: string; args: any; result: any };
export type AgentResponse = { reply?: string; actions?: AgentAction[]; transcript?: string; error?: string };
