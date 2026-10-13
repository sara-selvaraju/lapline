// Signing in, for the checking tools.
//
// M7 replaced basic auth with a password page and a cookie, so the tools post
// the password once and carry the cookie, as a browser does. With no
// APP_PASSWORD set — which is how the mock stack runs locally — there is
// nothing to do.

const PASSWORD = process.env.APP_PASSWORD;

/**
 * Signs in and returns what to send with each request: a `headers` object for
 * fetch, and `cookies` ready for a Playwright context.
 */
export async function signIn(base) {
  if (!PASSWORD) return { headers: {}, cookies: [] };

  const res = await fetch(`${base.replace(/\/$/, '')}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: PASSWORD }).toString(),
    redirect: 'manual',
  });
  const set = res.headers.get('set-cookie');
  if (!set) throw new Error(`sign-in refused by ${base} (status ${res.status})`);

  const pair = set.split(';')[0];
  const [name, value] = pair.split('=');
  const { hostname } = new URL(base);
  return {
    headers: { Cookie: pair },
    cookies: [{ name, value, domain: hostname, path: '/', httpOnly: true, sameSite: 'Lax' }],
  };
}
