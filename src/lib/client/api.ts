'use client';

/** Thin fetch wrapper: one place that knows the { ok, data, error } envelope. */

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
    credentials: 'same-origin',
  });

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // A non-JSON body means the request never reached a route handler.
    throw new ApiError(res.status, 'The server sent an unexpected response.');
  }

  const body = payload as { ok?: boolean; data?: T; error?: string; details?: unknown };
  if (!res.ok || body.ok === false) {
    throw new ApiError(res.status, body.error ?? 'Request failed.', body.details);
  }
  return body.data as T;
}

export const post = <T>(url: string, body: unknown) =>
  apiFetch<T>(url, { method: 'POST', body: JSON.stringify(body) });

export const patch = <T>(url: string, body: unknown) =>
  apiFetch<T>(url, { method: 'PATCH', body: JSON.stringify(body) });

export const put = <T>(url: string, body: unknown) =>
  apiFetch<T>(url, { method: 'PUT', body: JSON.stringify(body) });
