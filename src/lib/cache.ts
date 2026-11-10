/**
 * A local store of model output, so text that was translated once is not sent
 * to the model again. Entries are addressed by a hash of what produced them,
 * not by page URL: a page that changes re-translates only what changed, and
 * the same paragraph on another page is reused. Nothing leaves the browser.
 */

const DB_NAME = 'wisp';
const STORE = 'cache';
const AGE_INDEX = 'at';

interface Entry {
  value: string;
  /** When the entry was written, in ms since the epoch. */
  at: number;
}

let database: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  return (database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE).createIndex(AGE_INDEX, 'at');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

/** Runs one transaction and resolves with `result()` once it has committed. */
async function transact<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => void,
  result: () => T,
): Promise<T> {
  const transaction = (await open()).transaction(STORE, mode);
  work(transaction.objectStore(STORE));
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(result());
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });
}

/** A key that is the same exactly when all the parts are the same. */
export async function cacheKey(...parts: string[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(parts));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Looks up several keys at once. Keys that are not stored come back as null. */
export function getCached(keys: string[]): Promise<(string | null)[]> {
  const values: (string | null)[] = keys.map(() => null);
  return transact(
    'readonly',
    (store) => {
      keys.forEach((key, index) => {
        const request = store.get(key);
        request.onsuccess = () => {
          const entry = request.result as Entry | undefined;
          if (entry) values[index] = entry.value;
        };
      });
    },
    () => values,
  );
}

export function putCached(key: string, value: string, now = Date.now()): Promise<void> {
  const entry: Entry = { value, at: now };
  return transact(
    'readwrite',
    (store) => store.put(entry, key),
    () => undefined,
  );
}

/** Deletes every entry written more than `maxAgeMs` ago. */
export function pruneCache(maxAgeMs: number, now = Date.now()): Promise<void> {
  return transact(
    'readwrite',
    (store) => {
      const request = store.index(AGE_INDEX).openCursor(IDBKeyRange.upperBound(now - maxAgeMs, true));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
    },
    () => undefined,
  );
}
