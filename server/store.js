import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const dataDirectory = process.env.ANNOTATED_DATA_DIR || path.resolve(process.cwd(), 'data');
const storePath = path.join(dataDirectory, 'store.json');
const emptyStore = {
  annotations: [],
  comments: [],
  claims: [],
  media: [],
  mediaJobs: [],
  users: [{ id: 'local-tom', handle: 'tcballard', displayName: 'Tom Ballard' }],
};

let writeQueue = Promise.resolve();

const clone = (value) => JSON.parse(JSON.stringify(value));

export async function readStore() {
  try {
    const value = JSON.parse(await readFile(storePath, 'utf8'));
    return { ...clone(emptyStore), ...value };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(dataDirectory, { recursive: true });
    await writeFile(storePath, JSON.stringify(emptyStore, null, 2));
    return clone(emptyStore);
  }
}

export function updateStore(mutator) {
  const operation = writeQueue.then(async () => {
    const current = await readStore();
    const next = await mutator(current);
    await mkdir(dataDirectory, { recursive: true });
    const temporaryPath = `${storePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(next, null, 2));
    await rename(temporaryPath, storePath);
    return clone(next);
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

export { dataDirectory, storePath };
