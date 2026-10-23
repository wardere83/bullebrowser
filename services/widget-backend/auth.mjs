import { createHmac, timingSafeEqual } from 'node:crypto';

// Mint these on the trusted CRM server, never in the embed script. A static
// shared widget token is not a user identity or an authorization policy.
export function verifyIdentity(token, secret, now = Date.now()) {
  if (!secret || secret.length < 32 || typeof token !== 'string') return null;
  try {
    const [header, payload, signature, extra] = token.split('.');
    if (extra || !header || !payload || !signature) return null;
    const meta = JSON.parse(Buffer.from(header, 'base64url').toString());
    if (meta.alg !== 'HS256') return null;
    const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const seconds = Math.floor(now / 1000);
    if (typeof claims.sub !== 'string' || !claims.sub || claims.aud !== 'bullebrowser-widget' ||
        !Number.isFinite(claims.exp) || claims.exp <= seconds || claims.exp > seconds + 900 ||
        (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > seconds))) return null;
    return claims;
  } catch { return null; }
}

export function ownsSession(session, identity) {
  return !!session && !!identity && session.owner === identity.sub;
}

// Account-level CRM credentials cannot safely implement district-level access.
// Only explicitly authorized administrators get those tools. Ordinary users
// can use the DOM of their already-permissioned CRM page instead.
export function canUseAccountApi(identity) {
  return identity?.role === 'admin' && Array.isArray(identity.permissions) && identity.permissions.includes('eeo:account');
}
