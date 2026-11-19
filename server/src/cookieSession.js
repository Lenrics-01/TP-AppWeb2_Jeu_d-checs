// Le cookie de session du client (client/app/session.js), relu par l'API.
//
// Le client range le jeton de l'API dans un cookie signé « echecs_session ».
// Le navigateur l'envoie à l'ouverture de la connexion Socket.IO (même origine,
// grâce au proxy du client). L'API le relit avec la MÊME bibliothèque et le MÊME
// secret : un cookie modifié à la main n'a plus une signature valide et ne donne
// aucun jeton.
import { createCookieSessionStorage } from 'react-router';

// Doivent être identiques à ceux de client/app/session.js.
const COOKIE_NAME = 'echecs_session';
export const DEV_SESSION_SECRET = 'secret-de-developpement-seulement';

export function sessionSecretFromEnv(env) {
  if (env.NODE_ENV === 'production' && !env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET est obligatoire en production.');
  }
  return env.SESSION_SECRET ?? DEV_SESSION_SECRET;
}

export function createCookieSession(secret) {
  return createCookieSessionStorage({
    cookie: { name: COOKIE_NAME, secrets: [secret] },
  });
}

/** Le jeton de l'API contenu dans l'en-tête Cookie, ou null (absent, ou signature invalide). */
export async function readToken(cookieSession, cookieHeader) {
  const session = await cookieSession.getSession(cookieHeader);
  return session.get('token') ?? null;
}
