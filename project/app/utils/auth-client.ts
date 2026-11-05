export interface AccountUser {
  email: string;
  emailConfirmed: boolean;
  hasPassword: boolean;
  hasGoogleLogin: boolean;
}

export interface AuthSession {
  user: AccountUser | null;
  googleEnabled: boolean;
  csrfToken: string;
}

export class AuthRequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'AuthRequestError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAccountUser(value: unknown): value is AccountUser {
  return isRecord(value) && typeof value.email === 'string'
    && typeof value.emailConfirmed === 'boolean' && typeof value.hasPassword === 'boolean'
    && typeof value.hasGoogleLogin === 'boolean';
}

async function readResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('json')) {
    throw new AuthRequestError(`Account service returned an unexpected response (${response.status}).`, response.status);
  }
  const body: unknown = await response.json();
  if (!response.ok) {
    const details: string[] = [];
    if (isRecord(body)) {
      if (typeof body.detail === 'string') details.push(body.detail);
      if (isRecord(body.errors)) {
        for (const errors of Object.values(body.errors)) {
          if (Array.isArray(errors)) {
            details.push(...errors.filter((error): error is string => typeof error === 'string'));
          }
        }
      }
      if (!details.length && typeof body.title === 'string') details.push(body.title);
    }
    throw new AuthRequestError(details.join(' ') || `Account request failed (${response.status}).`, response.status);
  }
  return body;
}

export async function getAuthSession(signal?: AbortSignal): Promise<AuthSession> {
  const body = await readResponse(await fetch('/api/auth/session', {
    credentials: 'same-origin', cache: 'no-store', signal,
  }));
  if (!isRecord(body) || typeof body.csrfToken !== 'string' || !body.csrfToken
    || typeof body.googleEnabled !== 'boolean') {
    throw new Error('Account service returned an invalid session.');
  }
  const user = body.user;
  if (user !== null && !isAccountUser(user)) {
    throw new Error('Account service returned an invalid user.');
  }
  return {
    csrfToken: body.csrfToken, googleEnabled: body.googleEnabled,
    user,
  };
}

export type AuthAction = 'register' | 'login' | 'logout' | 'forgot-password'
  | 'reset-password' | 'confirm-email' | 'resend-confirmation' | 'password' | 'google/start' | 'google/unlink';

export async function submitAuth(action: AuthAction, data: Record<string, string>): Promise<unknown> {
  // Antiforgery tokens are bound to the current identity, which changes on sign-in/out.
  const session = await getAuthSession();
  return readResponse(await fetch(`/api/auth/${action}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': session.csrfToken },
    body: JSON.stringify(data),
  }));
}

export function googleRedirectUrl(value: unknown): string {
  if (!isRecord(value) || typeof value.url !== 'string') {
    throw new Error('Account service returned an invalid Google redirect.');
  }
  const url = new URL(value.url, window.location.origin);
  if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/auth/')) {
    throw new Error('Account service returned an unexpected Google redirect.');
  }
  return url.href;
}
