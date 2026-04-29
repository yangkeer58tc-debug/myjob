const STORAGE_KEY = 'myjob_candidate_contact_unlocks_v1';

type UnlockMap = Record<string, string>;

const readUnlockMap = (): UnlockMap => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as UnlockMap;
  } catch {
    return {};
  }
};

const writeUnlockMap = (map: UnlockMap) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
};

export const isCandidateContactUnlocked = (candidateId: string): boolean => {
  if (!candidateId) return false;
  const map = readUnlockMap();
  return Boolean(map[candidateId]);
};

export const unlockCandidateContact = (candidateId: string) => {
  if (!candidateId || typeof window === 'undefined') return;
  const map = readUnlockMap();
  map[candidateId] = new Date().toISOString();
  writeUnlockMap(map);
};
