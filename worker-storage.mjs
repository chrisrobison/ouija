// IndexedDB-backed persistence for WebLLM spirits & conversations.
// Provides an in-memory fallback if IndexedDB is unavailable or fails.

const DB_NAME = 'ouija-board';
const DB_VERSION = 1;
const STORE_SPIRITS = 'spirits';
const STORE_META = 'meta';

const inMemory = {
    meta: new Map(),
    spirits: new Map(),
};

let useMemory = typeof indexedDB === 'undefined';
let dbPromise = null;

function openDB() {
    if (useMemory) {
        return Promise.resolve(null);
    }
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE_SPIRITS)) {
                    db.createObjectStore(STORE_SPIRITS, { keyPath: '_id' });
                }
                if (!db.objectStoreNames.contains(STORE_META)) {
                    db.createObjectStore(STORE_META);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        }).catch((err) => {
            console.warn('[storage] IndexedDB unavailable, using in-memory fallback:', err);
            useMemory = true;
            dbPromise = null;
            return null;
        });
    }
    return dbPromise;
}

function memGet(store, key) {
    if (store === STORE_META) {
        return inMemory.meta.get(key) ?? null;
    }
    return inMemory.spirits.get(key) ?? null;
}

function memSet(store, key, value) {
    if (store === STORE_META) {
        inMemory.meta.set(key, value);
    } else {
        inMemory.spirits.set(key, value);
    }
}

function memDelete(store, key) {
    if (store === STORE_META) {
        inMemory.meta.delete(key);
    } else {
        inMemory.spirits.delete(key);
    }
}

export async function setCurrentSpiritId(id) {
    const db = await openDB();
    if (!db) {
        memSet(STORE_META, 'currentSpiritId', id);
        return;
    }
    await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_META, 'readwrite');
        tx.objectStore(STORE_META).put(id, 'currentSpiritId');
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}

export async function getCurrentSpiritId() {
    const db = await openDB();
    if (!db) {
        return memGet(STORE_META, 'currentSpiritId');
    }
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_META, 'readonly');
        const req = tx.objectStore(STORE_META).get('currentSpiritId');
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
    });
}

export async function saveSpiritRecord(record) {
    const db = await openDB();
    if (!db) {
        memSet(STORE_SPIRITS, record._id, record);
        return;
    }
    await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_SPIRITS, 'readwrite');
        tx.objectStore(STORE_SPIRITS).put(record);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}

export async function loadSpiritRecord(id) {
    if (!id) return null;
    const db = await openDB();
    if (!db) {
        return memGet(STORE_SPIRITS, id);
    }
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_SPIRITS, 'readonly');
        const req = tx.objectStore(STORE_SPIRITS).get(id);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
    });
}

export async function updateConversation(id, conversation) {
    if (!id) return;
    const record = await loadSpiritRecord(id);
    if (!record) return;
    record.conversation = conversation;
    await saveSpiritRecord(record);
}

export async function listSpirits() {
    const db = await openDB();
    if (!db) {
        return Array.from(inMemory.spirits.values());
    }
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_SPIRITS, 'readonly');
        const req = tx.objectStore(STORE_SPIRITS).getAll();
        req.onsuccess = () => resolve(req.result ?? []);
        req.onerror = () => reject(req.error);
    });
}

export async function deleteSpirit(id) {
    const db = await openDB();
    if (!db) {
        memDelete(STORE_SPIRITS, id);
        return;
    }
    await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_SPIRITS, 'readwrite');
        tx.objectStore(STORE_SPIRITS).delete(id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
}

export async function loadCurrentState() {
    const id = await getCurrentSpiritId();
    if (!id) return null;
    return loadSpiritRecord(id);
}

export async function clearAll() {
    inMemory.meta.clear();
    inMemory.spirits.clear();
    const db = await openDB();
    if (!db) return;
    await Promise.all([
        new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_META, 'readwrite');
            tx.objectStore(STORE_META).clear();
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        }),
        new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_SPIRITS, 'readwrite');
            tx.objectStore(STORE_SPIRITS).clear();
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        })
    ]);
}
