import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/repository/db.js';
import { createRepository } from '../src/repository/index.js';

describe('échéances de déconnexion', () => {
  it('ajoute les colonnes manquantes à une base créée avec l’ancien schéma', () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'echecs-migration-'));
    const file = path.join(folder, 'legacy.sqlite');
    const legacy = new DatabaseSync(file);
    legacy.exec(`
      CREATE TABLE games (
        code TEXT PRIMARY KEY,
        creator_id INTEGER NOT NULL,
        white_id INTEGER,
        black_id INTEGER,
        fen TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'waiting'
      );
    `);
    legacy.close();

    const db = openDatabase(file);
    const columns = db.prepare('PRAGMA table_info(games)').all().map((column) => column.name);
    db.close();
    fs.rmSync(folder, { recursive: true, force: true });

    assert.ok(columns.includes('white_disconnect_deadline'));
    assert.ok(columns.includes('black_disconnect_deadline'));
  });

  it('enregistre, liste et efface les échéances des parties actives', () => {
    const db = openDatabase();
    const repo = createRepository(db);
    try {
      const white = repo.accounts.upsertFromGithub({ githubId: 'white', name: 'white' });
      const black = repo.accounts.upsertFromGithub({ githubId: 'black', name: 'black' });
      const code = repo.games.create(white.id, 'start');
      assert.equal(repo.games.join(code, white.id, black.id), true);

      assert.equal(repo.games.setDeadline(code, 'white', 123456), true);
      assert.deepEqual(repo.games.listDeadlines().map((row) => ({ ...row })), [{
        code,
        white_disconnect_deadline: 123456,
        black_disconnect_deadline: null,
      }]);
      assert.equal(repo.games.clearDeadline(code, 'white'), true);
      assert.deepEqual(repo.games.listDeadlines(), []);
    } finally {
      repo.close();
    }
  });
});