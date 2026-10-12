import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { defineCustomElements as jeepSqlite } from 'jeep-sqlite/loader';

import { verifyPassword } from './auth.js';

const platform = Capacitor.getPlatform();
const sqlite = new SQLiteConnection(CapacitorSQLite);

let db = null;          // module-level, shared by every function
let initPromise = null; // makes sure setup only runs once

export function initDB() {
  if (!initPromise) {
    initPromise = setup().catch((err) => {
      initPromise = null; // allow a retry if setup failed
      throw err;
    });
  }
  return initPromise;
}

// Returns true if `table` already has a column called `column`.
async function columnExists(table, column) {
  const res = await db.query(`PRAGMA table_info(${table});`);
  return (res.values ?? []).some((c) => c.name === column);
}

// Each entry runs once, in order, and is recorded so it never runs again.
// To change the schema: append a new entry with the next id. Never edit old ones.
// Each `up` is idempotent (it checks before altering), so it is safe even if the
// column already exists, e.g. because CREATE TABLE already included it.
const MIGRATIONS = [
  {
    id: 1,
    up: async () => {
      if (!(await columnExists('art', 'file_size'))) {
        await db.execute(
          'ALTER TABLE art ADD COLUMN file_size INTEGER NOT NULL DEFAULT 0;'
        );
      }
    },
  },
  {
    id: 2,
    up: async () => {
      if (!(await columnExists('characters', 'position'))) {
        await db.execute(
          'ALTER TABLE characters ADD COLUMN position INTEGER NOT NULL DEFAULT 0;'
        );
      }
    },
  },
];

async function runMigrations() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const res = await db.query('SELECT id FROM schema_migrations');
  const applied = new Set((res.values ?? []).map((r) => r.id));

  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;

    await m.up();
    await db.run(
      'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)',
      [m.id, Date.now()]
    );
  }
}

async function setup() {
  if (platform === 'web') {
    jeepSqlite(window);
    const el = document.createElement('jeep-sqlite');
    document.body.appendChild(el);
    await customElements.whenDefined('jeep-sqlite');
    await sqlite.initWebStore();
  }

  db = await sqlite.createConnection('app', false, 'no-encryption', 1, false);
  await db.open();

  await db.execute('PRAGMA foreign_keys = ON;');

  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      fullname TEXT NOT NULL,
      gender TEXT NOT NULL CHECK (gender IN ('male', 'female')),
      description TEXT NOT NULL DEFAULT '',
      character_groups TEXT NOT NULL DEFAULT '[]',
      tags TEXT NOT NULL DEFAULT '[]',
      position INTEGER NOT NULL DEFAULT 0,
      UNIQUE (user_id, fullname),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS art (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      art_name TEXT NOT NULL,
      width INTEGER NOT NULL CHECK (width > 0),
      height INTEGER NOT NULL CHECK (height > 0),
      aspect_ratio REAL GENERATED ALWAYS AS (
        CAST(width AS REAL) / height
      ) STORED,
      art_type TEXT NOT NULL CHECK (art_type IN ('image', 'video')),
      art_purpose TEXT NOT NULL CHECK (art_purpose IN ('character_art', 'mood_board_art')),
      UNIQUE (user_id, art_name),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tag_name TEXT NOT NULL,
      UNIQUE (user_id, tag_name),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS charactergroups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      group_name TEXT NOT NULL,
      UNIQUE (user_id, group_name),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS profilecontainers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      container_name TEXT NOT NULL DEFAULT 'untitled container',
      container_text TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
    );
  `);

  /*await db.execute(`
    CREATE TABLE IF NOT EXISTS relationships (
    )
  `)*/

  await runMigrations();

  await persist();
  return db;
}

// On web, changes only survive a refresh once saved to the store.
// On Android/iOS this does nothing.
async function persist() {
  if (platform === 'web') await sqlite.saveToStore('app');
}

// Arrays/objects are stored as JSON text; strings are assumed to be JSON already.
function toJsonText(value, fallback = '[]') {
  if (value === undefined || value === null) return fallback;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export async function createUser(username, passwordHash) {
  try {
    await initDB();
    await db.run(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      [username, passwordHash]
    );
    await persist();
    return { ok: true };
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return { ok: false, error: 'That username is already taken.' };
    }
    console.error(err);
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}

export async function getUser(username) {
  await initDB();
  const res = await db.query('SELECT * FROM users WHERE username = ?', [username]);
  return res.values?.[0] ?? null;
}

export async function loginUser(username, password) {
  try {
    const user = await getUser(username);
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return { ok: false, error: 'Wrong username or password.' };
    }
    return { ok: true, user: { id: user.id, username: user.username } };
  } catch (err) {
    console.error(err);
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}

export async function addCharacter(userId, { fullname, description = '', gender }) {
  try {
    await initDB();
    const result = await db.run(
      `INSERT INTO characters (user_id, fullname, description, gender, position)
       VALUES (?, ?, ?, ?, COALESCE(
         (SELECT MAX(position) FROM characters WHERE user_id = ?) + 1000,
         1000
       ))`,
      [userId, fullname, description, gender, userId]
    );
    const characterId = result.changes.lastId;

    const rowRes = await db.query('SELECT * FROM characters WHERE id = ?', [characterId]);
    const character = rowRes.values?.[0] ?? null;

    await persist();
    return { ok: true, characterId, character };
  } catch (err) {
    const msg = String(err.message);
    if (msg.includes('UNIQUE')) {
      return { ok: false, error: 'You already have a character with that name.' };
    }
    if (msg.includes('CHECK')) {
      return { ok: false, error: 'Choose a valid gender.' };
    }
    console.error(err);
    return { ok: false, error: 'Could not save character.' };
  }
}

export async function addArt(userId, { characterId, artName, width, height, artType, artPurpose = 'character_art' }) {
  try {
    await initDB();

    // The foreign key only checks that the character exists, not that it belongs to this user
    const owner = await db.query(
      'SELECT id FROM characters WHERE id = ? AND user_id = ?',
      [characterId, userId]
    );
    if (!owner.values?.length) {
      return { ok: false, error: 'Character not found.' };
    }

    const res = await db.run(
      `INSERT INTO art (user_id, character_id, art_name, width, height, art_type, art_purpose)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, characterId, artName.trim(), width, height, artType, artPurpose]
    );
    const id = res.changes.lastId;

    const rowRes = await db.query('SELECT * FROM art WHERE id = ?', [id]);
    const art = rowRes.values?.[0] ?? null;

    await persist();
    return { ok: true, id, art };
  } catch (err) {
    const msg = String(err.message);
    if (msg.includes('UNIQUE')) {
      return { ok: false, error: 'You already have art with that name.' };
    }
    if (msg.includes('CHECK')) {
      return { ok: false, error: 'Invalid art size, type, or purpose.' };
    }
    console.error(err);
    return { ok: false, error: 'Could not save art.' };
  }
}

export async function deleteArt(userId, artId, characterId) {
  try {
    await initDB();

    const owner = await db.query(
      'SELECT id FROM characters WHERE id = ? AND user_id = ?',
      [characterId, userId]
    );
    if (!owner.values?.length) {
      return { ok: false, error: 'Character not found.' };
    }

    // user_id is in the DELETE itself so the mutation enforces ownership too
    const result = await db.run(
      'DELETE FROM art WHERE character_id = ? AND user_id = ? AND id = ?',
      [characterId, userId, artId]
    );

    await persist();

    return {
      ok: true,
      deleted: (result.changes?.changes ?? 0) > 0,
    };
  } catch (err) {
    console.error(err);
    return { ok: false, error: 'Could not delete art.' };
  }
}

export async function countAndInfoOfArt(userId, characterId) {
  try {
    await initDB();

    const owner = await db.query(
      'SELECT id FROM characters WHERE id = ? AND user_id = ?',
      [characterId, userId]
    );
    if (!owner.values?.length) {
      return { ok: false, error: 'Character not found.' };
    }

    const info = await db.query(
      'SELECT * FROM art WHERE character_id = ? AND user_id = ?', [characterId, userId]
    );

    const result = await db.query(
      'SELECT COUNT(*) AS art_count FROM art WHERE character_id = ? AND user_id = ?',
      [characterId, userId]
    );

    const count = result.values?.[0]?.art_count ?? 0;
    return { ok: true, artCount: count, artInfo: info };
  } catch (err) {
    console.error(err);
    return { ok: false, error: 'Could not count art.' };
  }
}

export async function getCharacters(userId) {
  try {
    await initDB();

    const characters = await db.query(
      'SELECT * FROM characters WHERE user_id = ? ORDER BY position ASC',
      [userId]
    );

    return { ok: true, userCharacters: characters };
  } catch (err) {
    console.error(err);
    return { ok: false, error: 'Something went wrong.' };
  }
}

export async function getCharacter(userId, characterId) {
  try {
    await initDB();

    const result = await db.query(
      'SELECT * FROM characters WHERE user_id = ? AND id = ?',
      [userId, characterId]
    );

    return { ok: true, userCharacter: result.values?.[0] ?? null };
  } catch (err) {
    console.error(err);
    return { ok: false, error: 'Could not get character.' };
  }
}

export async function updateCharacter(userId, { characterId, fullname, gender, description, characterGroups, tags }) {
  try {
    await initDB();

    const groupsText = toJsonText(characterGroups);
    const tagsText = toJsonText(tags);

    await db.run(
      `UPDATE characters
       SET fullname = ?, gender = ?, description = ?, character_groups = ?, tags = ?
       WHERE id = ? AND user_id = ?
       AND (
         fullname IS NOT ? OR
         gender IS NOT ? OR
         description IS NOT ? OR
         character_groups IS NOT ? OR
         tags IS NOT ?
       )`,
      [
        fullname, gender, description, groupsText, tagsText,
        characterId, userId,
        fullname, gender, description, groupsText, tagsText,
      ]
    );

    // UPDATE doesn't return rows, so read the character back
    const updated = await db.query(
      'SELECT * FROM characters WHERE id = ? AND user_id = ?',
      [characterId, userId]
    );

    await persist();

    return { ok: true, updatedCharacter: updated.values?.[0] ?? null };
  } catch (err) {
    const msg = String(err.message);
    if (msg.includes('UNIQUE')) {
      return { ok: false, error: 'You already have a character with that name.' };
    }
    if (msg.includes('CHECK')) {
      return { ok: false, error: 'Choose a valid gender.' };
    }
    console.error(err);
    return { ok: false, error: 'Could not update character.' };
  }
}