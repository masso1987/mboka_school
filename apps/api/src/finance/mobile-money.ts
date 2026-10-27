import { HttpStatus } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ApiException } from '../common/api-error';

/**
 * Operator collection APIs (Phase 6). Mboka starts a payment, then asks the operator for its result —
 * operator notifications are unsigned, so they only trigger a check and are never trusted on their own.
 *
 * MTN MoMo: Collection API v1_0 (token, requesttopay, requesttopay/{referenceId}).
 * Orange Money: Web Payment API (token, webpayment, transactionstatus) — the payer confirms on Orange's page.
 * Both must be validated against the operator's sandbox with the school's own merchant credentials.
 */
export interface MtnConfig {
  kind: 'MTN_MOMO';
  baseUrl: string;
  targetEnvironment: string;
  subscriptionKey: string;
  apiUser: string;
  apiKey: string;
}

export interface OrangeConfig {
  kind: 'ORANGE_MONEY';
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  merchantKey: string;
  returnUrl: string;
}

export type OperatorConfig = MtnConfig | OrangeConfig;

export interface CollectionRequest {
  /** Our payment id; MTN's X-Reference-Id and Orange's order_id. */
  reference: string;
  amount: string;
  currency: string;
  msisdn?: string;
  description: string;
  callbackUrl: string;
}

export interface CollectionStarted {
  /** Handles stored on the payment to check it later (never credentials). */
  state: Record<string, string>;
  /** Orange only: the page where the payer confirms. */
  paymentUrl?: string;
}

export interface CollectionResult {
  status: 'SUCCESS' | 'FAILED' | 'PENDING';
  transactionId: string | null;
  amount: string | null;
  currency: string | null;
  reason: string | null;
}

const TIMEOUT_MS = 15_000;
/** Official operator API hosts; others are refused in production to prevent server-side request forgery. */
const DEFAULT_HOSTS = ['sandbox.momodeveloper.mtn.com', 'proxy.momoapi.mtn.com', 'api.orange.com'];

export function assertAllowedBaseUrl(raw: string): void {
  const url = new URL(raw);
  const allowed = (process.env.MOBILE_MONEY_ALLOWED_HOSTS ?? DEFAULT_HOSTS.join(','))
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const local = process.env.NODE_ENV !== 'production' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (local) return;
  if (url.protocol !== 'https:' || !allowed.includes(url.hostname.toLowerCase())) {
    throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'PROVIDER_HOST_NOT_ALLOWED', `Operator API host ${url.hostname} is not allowed`);
  }
}

export class OperatorError extends Error {
  constructor(
    readonly operator: string,
    readonly httpStatus: number | null,
    message: string,
  ) {
    super(message);
  }
}

async function call(operator: string, url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new OperatorError(operator, null, `unreachable: ${(e as Error).name}`);
  }
  return res;
}

// Access tokens are cached per credential set until shortly before they expire.
const tokens = new Map<string, { token: string; until: number }>();

async function cachedToken(key: string, fetchToken: () => Promise<{ token: string; expiresIn: number }>): Promise<string> {
  const hit = tokens.get(key);
  if (hit && hit.until > Date.now()) return hit.token;
  const t = await fetchToken();
  tokens.set(key, { token: t.token, until: Date.now() + Math.max(0, t.expiresIn - 60) * 1000 });
  return t.token;
}

const tokenKey = (...parts: string[]) => createHash('sha256').update(parts.join('\n')).digest('hex');
const trimSlash = (u: string) => u.replace(/\/+$/, '');

// ------------------------------------------------------------------ MTN MoMo

async function mtnToken(c: MtnConfig): Promise<string> {
  return cachedToken(tokenKey('mtn', c.baseUrl, c.apiUser, c.apiKey), async () => {
    const res = await call('MTN_MOMO', `${trimSlash(c.baseUrl)}/collection/token/`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${c.apiUser}:${c.apiKey}`).toString('base64')}`,
        'Ocp-Apim-Subscription-Key': c.subscriptionKey,
      },
    });
    if (!res.ok) throw new OperatorError('MTN_MOMO', res.status, 'token refused');
    const body = (await res.json()) as { access_token: string; expires_in: number };
    return { token: body.access_token, expiresIn: Number(body.expires_in) || 3600 };
  });
}

async function mtnHeaders(c: MtnConfig): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${await mtnToken(c)}`,
    'X-Target-Environment': c.targetEnvironment,
    'Ocp-Apim-Subscription-Key': c.subscriptionKey,
  };
}

async function mtnStart(c: MtnConfig, r: CollectionRequest): Promise<CollectionStarted> {
  if (!r.msisdn) throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'PAYER_MSISDN_REQUIRED', 'Enter the Mobile Money number to debit');
  const res = await call('MTN_MOMO', `${trimSlash(c.baseUrl)}/collection/v1_0/requesttopay`, {
    method: 'POST',
    headers: { ...(await mtnHeaders(c)), 'X-Reference-Id': r.reference, 'X-Callback-Url': r.callbackUrl, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: r.amount,
      currency: r.currency,
      externalId: r.reference,
      payer: { partyIdType: 'MSISDN', partyId: r.msisdn },
      payerMessage: r.description.slice(0, 160),
      payeeNote: r.description.slice(0, 160),
    }),
  });
  // 202 Accepted: the payer gets a prompt on their phone.
  if (res.status !== 202) throw new OperatorError('MTN_MOMO', res.status, 'request to pay refused');
  return { state: { referenceId: r.reference } };
}

async function mtnStatus(c: MtnConfig, state: Record<string, string>): Promise<CollectionResult> {
  const res = await call('MTN_MOMO', `${trimSlash(c.baseUrl)}/collection/v1_0/requesttopay/${encodeURIComponent(state.referenceId ?? '')}`, {
    headers: await mtnHeaders(c),
  });
  if (res.status === 404) return { status: 'PENDING', transactionId: null, amount: null, currency: null, reason: 'not_found_yet' };
  if (!res.ok) throw new OperatorError('MTN_MOMO', res.status, 'status unavailable');
  const b = (await res.json()) as { status: string; amount?: string; currency?: string; financialTransactionId?: string; reason?: string | { code?: string } };
  const status = b.status === 'SUCCESSFUL' ? 'SUCCESS' : b.status === 'FAILED' || b.status === 'REJECTED' || b.status === 'TIMEOUT' ? 'FAILED' : 'PENDING';
  const reason = typeof b.reason === 'string' ? b.reason : (b.reason?.code ?? (status === 'FAILED' ? b.status : null));
  return { status, transactionId: b.financialTransactionId ?? null, amount: b.amount ?? null, currency: b.currency ?? null, reason };
}

// ------------------------------------------------------------------ Orange Money

async function orangeToken(c: OrangeConfig): Promise<string> {
  return cachedToken(tokenKey('orange', c.baseUrl, c.clientId, c.clientSecret), async () => {
    const res = await call('ORANGE_MONEY', `${trimSlash(c.baseUrl)}/oauth/v3/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new OperatorError('ORANGE_MONEY', res.status, 'token refused');
    const body = (await res.json()) as { access_token: string; expires_in: number };
    return { token: body.access_token, expiresIn: Number(body.expires_in) || 3600 };
  });
}

async function orangeStart(c: OrangeConfig, r: CollectionRequest): Promise<CollectionStarted> {
  const res = await call('ORANGE_MONEY', `${trimSlash(c.baseUrl)}/orange-money-webpay/cm/v1/webpayment`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await orangeToken(c)}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      merchant_key: c.merchantKey,
      currency: r.currency,
      order_id: r.reference,
      amount: Number(r.amount),
      return_url: c.returnUrl,
      cancel_url: c.returnUrl,
      notif_url: r.callbackUrl,
      lang: 'fr',
      reference: r.description.slice(0, 30),
    }),
  });
  if (res.status !== 201 && res.status !== 200) throw new OperatorError('ORANGE_MONEY', res.status, 'web payment refused');
  const b = (await res.json()) as { pay_token: string; payment_url: string; notif_token: string };
  return { state: { payToken: b.pay_token, notifToken: b.notif_token, orderId: r.reference, amount: r.amount }, paymentUrl: b.payment_url };
}

async function orangeStatus(c: OrangeConfig, state: Record<string, string>): Promise<CollectionResult> {
  const res = await call('ORANGE_MONEY', `${trimSlash(c.baseUrl)}/orange-money-webpay/cm/v1/transactionstatus`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await orangeToken(c)}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ order_id: state.orderId, amount: Number(state.amount), pay_token: state.payToken }),
  });
  if (!res.ok) throw new OperatorError('ORANGE_MONEY', res.status, 'status unavailable');
  const b = (await res.json()) as { status: string; txnid?: string };
  const status = b.status === 'SUCCESS' ? 'SUCCESS' : b.status === 'FAILED' || b.status === 'EXPIRED' ? 'FAILED' : 'PENDING';
  // Orange's status echoes our order; the amount checked is the one we registered for that pay_token.
  return { status, transactionId: b.txnid ?? null, amount: state.amount ?? null, currency: null, reason: status === 'FAILED' ? b.status : null };
}

// ------------------------------------------------------------------ dispatch

export function startCollection(c: OperatorConfig, r: CollectionRequest): Promise<CollectionStarted> {
  assertAllowedBaseUrl(c.baseUrl);
  return c.kind === 'MTN_MOMO' ? mtnStart(c, r) : orangeStart(c, r);
}

export function collectionStatus(c: OperatorConfig, state: Record<string, string>): Promise<CollectionResult> {
  assertAllowedBaseUrl(c.baseUrl);
  return c.kind === 'MTN_MOMO' ? mtnStatus(c, state) : orangeStatus(c, state);
}

/** Test hook: forget cached access tokens. */
export function clearOperatorTokens(): void {
  tokens.clear();
}
