import type { AttendanceSubmitInput } from '@mboka/shared';
import { api, ApiRequestError } from './api';

/**
 * Local storage for the offline workflows (spec §10.2/10.3), namespaced per school:
 *  - mboka.attendance.pending.<tenant>.<class>.<date>  unsent register (with its operation id)
 *  - mboka.cache.register.<tenant>.<class>.<date>      last register loaded, to work offline
 *  - mboka.draft.marks.<tenant>.<classSubject>.<period> unsaved mark-entry draft
 * Only what those screens need is kept, and everything is cleared at sign-out.
 */
const PREFIX = 'mboka.';
export const OFFLINE_EVENT = 'mboka:offline-changed';

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode, quota): offline support degrades, online keeps working.
  }
  window.dispatchEvent(new Event(OFFLINE_EVENT));
}
function keys(prefix: string): string[] {
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith(prefix));
  } catch {
    return [];
  }
}

export function readJson<T>(key: string): T | null {
  const raw = safeGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
export function writeJson(key: string, value: unknown | null) {
  safeSet(key, value === null ? null : JSON.stringify(value));
}

// ------------------------------------------------------------ attendance

export const pendingKey = (tenant: string, classId: string, date: string) => `${PREFIX}attendance.pending.${tenant}.${classId}.${date}`;
export const registerCacheKey = (tenant: string, classId: string, date: string) => `${PREFIX}cache.register.${tenant}.${classId}.${date}`;

export function pendingSubmissions(tenant: string): { key: string; payload: AttendanceSubmitInput }[] {
  return keys(`${PREFIX}attendance.pending.${tenant}.`).flatMap((key) => {
    const payload = readJson<AttendanceSubmitInput>(key);
    return payload ? [{ key, payload }] : [];
  });
}

export type FlushResult = { sent: number; stillPending: number; rejected: { key: string; error: ApiRequestError }[] };

/**
 * Sends every pending register with its original operation id: the server applies each once,
 * whatever happened before (§10.3). Network failures leave them pending; server rejections
 * (conflict, validation) are removed from the queue and reported for the user to resolve.
 */
export async function flushPending(tenant: string): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, stillPending: 0, rejected: [] };
  for (const { key, payload } of pendingSubmissions(tenant)) {
    try {
      await api('/attendance/submit', { method: 'POST', body: payload });
      writeJson(key, null);
      result.sent++;
    } catch (e) {
      if (e instanceof ApiRequestError) {
        writeJson(key, null);
        result.rejected.push({ key, error: e });
      } else {
        result.stillPending++;
      }
    }
  }
  return result;
}

// ------------------------------------------------------------ mark-entry drafts

export const marksDraftKey = (tenant: string, classSubjectId: string, periodId: string) => `${PREFIX}draft.marks.${tenant}.${classSubjectId}.${periodId}`;

export function hasUnsyncedWork(): number {
  return keys(`${PREFIX}attendance.pending.`).length + keys(`${PREFIX}draft.marks.`).length;
}

/** Sign-out and school change: drop school data kept on this device (keeps UI preferences). */
export function clearLocalSchoolData() {
  for (const k of [...keys(`${PREFIX}attendance.`), ...keys(`${PREFIX}cache.`), ...keys(`${PREFIX}draft.`)]) {
    try {
      localStorage.removeItem(k);
    } catch {
      // ignore
    }
  }
  window.dispatchEvent(new Event(OFFLINE_EVENT));
}

export function isNetworkError(e: unknown): boolean {
  return !(e instanceof ApiRequestError);
}
