import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEV_SESSION_SECRET, sessionSecretFromEnv } from '../src/cookieSession.js';

describe('secret de session', () => {
  it('refuse de démarrer en production sans SESSION_SECRET', () => {
    assert.throws(
      () => sessionSecretFromEnv({ NODE_ENV: 'production' }),
      /SESSION_SECRET est obligatoire en production/,
    );
  });

  it('utilise le secret de développement hors production', () => {
    assert.equal(sessionSecretFromEnv({ NODE_ENV: 'development' }), DEV_SESSION_SECRET);
  });

  it('utilise le secret fourni', () => {
    assert.equal(
      sessionSecretFromEnv({ NODE_ENV: 'production', SESSION_SECRET: 'secret-configure' }),
      'secret-configure',
    );
  });
});