/** Response shapes of the finance endpoints. Amounts are exact decimal strings. */

export interface FinanceSettings {
  reportingCurrency: string;
  enabledCurrencies: string[];
  expenseApprovalThreshold: string;
  currencies?: { code: string; minorUnits: number; nameFr: string; nameEn: string }[];
  providers?: string[];
}

export interface InvoiceRow {
  id: string;
  number: string;
  currency: string;
  issueDate: string;
  status: 'ISSUED' | 'CANCELLED';
  paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';
  total: string;
  paid: string;
  balance: string;
  discounts: string;
  student?: { id: string; matricule: string; firstName: string; lastName: string };
}

export interface InvoiceDetail extends InvoiceRow {
  lines: { id: string; kind: 'CHARGE' | 'DISCOUNT'; description: string; amount: string; dueDate: string | null; discountKind: string | null }[];
  payments: { paymentId: string; status: string; method: string; receivedOn: string; receipt: string | null; amount: string; paymentCurrency: string; invoiceAmount: string }[];
  cancelledReason: string | null;
}

export interface PaymentView {
  id: string;
  status: 'PENDING_VERIFICATION' | 'CONFIRMED' | 'FAILED' | 'REVERSED';
  receipt: string | null;
  student: { id: string; matricule: string; firstName: string; lastName: string };
  method: string;
  currency: string;
  amount: string;
  receivedOn: string;
  externalReference: string | null;
  provider?: string | null;
  /** Orange Money: the page where the payer confirms. */
  paymentUrl?: string | null;
  reporting: { currency: string; amount: string; rate: string };
  allocations: { invoiceId: string; invoiceNumber: string; amount: string; invoiceAmount: string; invoiceCurrency: string; rate: string }[];
  credit: string;
  reversal: { at: string; date: string | null; reason: string | null } | null;
  replayed?: boolean;
}

export interface Statement {
  student: { id: string; matricule: string; firstName: string; lastName: string };
  balances: { currency: string; total: string; paid: string; balance: string }[];
  invoices: InvoiceRow[];
  payments: { id: string; receivedOn: string; method: string; status: string; currency: string; amount: string; credit: string; receipt: string | null }[];
}

export interface CashierSession {
  id: string;
  cashier: string | null;
  currency: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt: string | null;
  openingFloat: string;
  cashTaken: string;
  expectedAmount: string;
  countedAmount: string | null;
  discrepancy: string | null;
  payments: { id: string; receipt: string | null; student: string; amount: string; status: string }[];
}

export interface FeeSchedule {
  id: string;
  name: string;
  currency: string;
  amount: string;
  billedCount: number;
  category: { code: string; nameFr: string; nameEn: string; kind: string };
  installments: { label: string; dueDate: string; amount: string }[];
}

export interface RefundRow {
  id: string;
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED';
  amount: string;
  currency: string;
  reason: string;
  student: { id: string; firstName: string; lastName: string; matricule: string };
  isMine: boolean;
  createdAt: string;
}

export interface ExpenseRow {
  id: string;
  number: string;
  status: 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'PAID' | 'CANCELLED' | 'DRAFT';
  category: { code: string; nameFr: string; nameEn: string };
  supplier: string | null;
  description: string;
  currency: string;
  amount: string;
  expenseDate: string;
  isMine: boolean;
}

export interface FinanceSummary {
  period: { from: string; to: string };
  currency: string;
  status: 'FINAL' | 'PROVISIONAL';
  billed: string;
  collected: string;
  collectedByMethod: { method: string; amount: string }[];
  refunds: string;
  pendingVerification: { count: number; amount: string };
  outstanding: string;
  amountsDue: string;
  eligibleCollected: string;
  collectionRate: number | null;
  expenses: string;
  expensesByCategory: { category: { code: string; nameFr: string; nameEn: string }; amount: string }[];
  exchangeDifferences: string;
  netCashResult: string;
  operatingResult: string;
  definitions: Record<string, string>;
}

export interface Aging {
  asOf: string;
  currency: string;
  buckets: { notDue: string; d0_30: string; d31_60: string; d61_90: string; d90plus: string };
  totalOverdue: string;
  students: { id: string; matricule: string; firstName: string; lastName: string; overdue: string }[];
}

export interface BudgetReport {
  academicYear: { id: string; name: string };
  budget: { id: string; name: string } | null;
  currency: string;
  basis: string;
  lines: { category: { id: string; code: string; nameFr: string; nameEn: string }; budgeted: string; actual: string; remaining: string; utilization: number | null; overrun: boolean }[];
}
