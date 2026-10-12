import { Preferences } from '@capacitor/preferences';

const KEY = 'session';

export async function setSession(user) {
  // store only non-sensitive info, never the password or hash
  await Preferences.set({ key: KEY, value: JSON.stringify({ id: user.id, username: user.username }) });
}

export async function getSession() {
  const { value } = await Preferences.get({ key: KEY });
  return value ? JSON.parse(value) : null;
}

export async function clearSession() {
  await Preferences.remove({ key: KEY });
}