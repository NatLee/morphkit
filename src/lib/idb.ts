import type { AssetRec, ProjectRec } from './studioTypes';

/** Tiny IndexedDB wrapper — projects + assets persist across sessions. */

const DB_NAME = 'morphkit-studio';
let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('projects', { keyPath: 'id' });
        const assets = db.createObjectStore('assets', { keyPath: 'id' });
        assets.createIndex('projectId', 'projectId');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function store(name: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export async function putProject(p: ProjectRec): Promise<void> {
  await req((await store('projects', 'readwrite')).put(p));
}

export async function listProjects(): Promise<ProjectRec[]> {
  return req((await store('projects', 'readonly')).getAll() as IDBRequest<ProjectRec[]>);
}

export async function deleteProject(id: string): Promise<void> {
  await req((await store('projects', 'readwrite')).delete(id));
  const assets = await listAssets(id);
  for (const a of assets) await deleteAsset(a.id);
}

export async function putAsset(a: AssetRec): Promise<void> {
  await req((await store('assets', 'readwrite')).put(a));
}

export async function listAssets(projectId: string): Promise<AssetRec[]> {
  const s = await store('assets', 'readonly');
  return req(s.index('projectId').getAll(projectId) as IDBRequest<AssetRec[]>);
}

export async function deleteAsset(id: string): Promise<void> {
  await req((await store('assets', 'readwrite')).delete(id));
}
