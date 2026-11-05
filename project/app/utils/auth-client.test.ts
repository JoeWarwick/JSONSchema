import { AuthRequestError, getAuthSession, googleRedirectUrl, submitAuth } from './auth-client';

const anonymous = { user: null, googleEnabled: false, csrfToken: 'fresh-token' };

function response(body: unknown, status = 200, contentType = 'application/json'): Response {
  return {
    status, ok: status >= 200 && status < 300,
    headers: new Headers({ 'content-type': contentType }),
    json: async () => body,
  } as Response;
}

describe('account API client', () => {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });
  afterAll(() => { global.fetch = originalFetch; });

  it('fetches same-origin uncached sessions and validates the user shape', async () => {
    fetchMock.mockResolvedValueOnce(response(anonymous));
    expect(await getAuthSession()).toEqual(anonymous);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/session', expect.objectContaining({
      credentials: 'same-origin', cache: 'no-store',
    }));
    fetchMock.mockResolvedValueOnce(response({ ...anonymous, user: { email: 'test@example.com' } }));
    await expect(getAuthSession()).rejects.toThrow('invalid user');
    fetchMock.mockResolvedValueOnce(response({ ...anonymous, csrfToken: '' }));
    await expect(getAuthSession()).rejects.toThrow('invalid session');
  });

  it('gets fresh CSRF tokens before mutations and sends credentials', async () => {
    fetchMock.mockResolvedValueOnce(response(anonymous)).mockResolvedValueOnce(response(null, 204));
    await expect(submitAuth('logout', {})).resolves.toBeNull();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/auth/logout', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': 'fresh-token' },
      body: '{}',
    });
  });

  it('surfaces ProblemDetails including validation errors', async () => {
    fetchMock.mockResolvedValueOnce(response(anonymous)).mockResolvedValueOnce(response({
      title: 'Validation failed', errors: { password: ['Password is too short.'] },
    }, 400, 'application/problem+json'));
    await expect(submitAuth('register', { email: 'test@example.com', password: 'short' }))
      .rejects.toThrow('Password is too short.');
  });

  it('does not submit when a session request fails, and rejects HTML fallback responses', async () => {
    fetchMock.mockResolvedValueOnce(response({ detail: 'Too many requests.' }, 429));
    await expect(submitAuth('login', {})).rejects.toBeInstanceOf(AuthRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(response(null, 200, 'text/html'));
    await expect(getAuthSession()).rejects.toThrow('unexpected response');
  });

  it('accepts only same-origin auth redirects', () => {
    expect(googleRedirectUrl({ url: '/api/auth/google/challenge' }))
      .toBe(`${window.location.origin}/api/auth/google/challenge`);
    expect(() => googleRedirectUrl({ url: 'https://other.example/api/auth/callback' })).toThrow();
    expect(() => googleRedirectUrl({ url: 'javascript:alert(1)' })).toThrow();
    expect(() => googleRedirectUrl({ url: '/unrelated' })).toThrow();
  });
});
