'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..');
const DATA_DIR = '/virtual/data';
const SIDECAR_PATH = `${DATA_DIR}/job_sharepoint_folders.json`;

async function withMockedModules(mocks, fn) {
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return await fn();
  } finally {
    Module._load = originalLoad;
  }
}

function freshRequire(relativePath) {
  const resolved = require.resolve(path.join(root, relativePath));
  delete require.cache[resolved];
  return require(resolved);
}

function createMemoryFs(initialFiles = {}) {
  const files = new Map(Object.entries(initialFiles));
  const operations = [];

  return {
    operations,
    existsSync(filePath) {
      return files.has(filePath);
    },
    mkdirSync(dirPath) {
      operations.push({ op: 'mkdir', dirPath });
    },
    readFileSync(filePath, encoding) {
      operations.push({ op: 'read', filePath });
      if (!files.has(filePath)) {
        const err = new Error(`ENOENT: no such file or directory, open '${filePath}'`);
        err.code = 'ENOENT';
        throw err;
      }
      const value = files.get(filePath);
      if (encoding) return Buffer.isBuffer(value) ? value.toString(encoding) : String(value);
      return Buffer.isBuffer(value) ? value : Buffer.from(String(value));
    },
    writeFileSync(filePath, content) {
      operations.push({ op: 'write', filePath });
      files.set(filePath, Buffer.isBuffer(content) ? content.toString('utf8') : String(content));
    },
    renameSync(fromPath, toPath) {
      operations.push({ op: 'rename', fromPath, toPath });
      if (!files.has(fromPath)) {
        const err = new Error(`ENOENT: no such file or directory, rename '${fromPath}'`);
        err.code = 'ENOENT';
        throw err;
      }
      files.set(toPath, files.get(fromPath));
      files.delete(fromPath);
    },
    readJson(filePath) {
      return JSON.parse(files.get(filePath));
    },
    hasFile(filePath) {
      return files.has(filePath);
    },
    tempFiles() {
      return [...files.keys()].filter((filePath) => filePath.includes('.tmp-'));
    },
  };
}

function sidecar(folders = []) {
  return JSON.stringify({
    generatedAt: '2026-07-02T12:00:00.000Z',
    count: folders.length,
    folders,
  }, null, 2);
}

function logger() {
  return { info() {}, warn() {} };
}

async function loadService({ fsMock, graph }) {
  let service;
  await withMockedModules({
    fs: fsMock,
    '../../../lib/graph': graph,
    '../../../lib/logger': logger(),
    '../../../config': { DATA_DIR },
  }, async () => {
    service = freshRequire('modules/invoices/services/sharepointFilingService.js');
  });
  return service;
}

test('resolveJobFolder returns sidecar hit without live Graph calls', async () => {
  const fsMock = createMemoryFs({
    [SIDECAR_PATH]: sidecar([{
      jobNumber: '26-123',
      driveId: 'drive-id',
      itemId: 'folder-id',
      folderPath: '26-000/26-123 - Sidecar Job',
      folderName: '26-123 - Sidecar Job',
      webUrl: 'https://sharepoint/job',
      resolvedAt: '2026-07-02T12:00:00.000Z',
      source: 'generated',
    }]),
  });
  const graphCalls = [];
  const graph = {
    listDriveChildren: async (_driveId, folderPath) => {
      graphCalls.push(folderPath);
      throw new Error('Graph should not be called on sidecar hit');
    },
  };

  const { resolveJobFolder } = await loadService({ fsMock, graph });
  const result = await resolveJobFolder('26-123');

  assert.equal(result, '26-000/26-123 - Sidecar Job');
  assert.deepEqual(graphCalls, []);
});

test('resolveJobFolder miss falls back live and atomically appends sidecar entry', async () => {
  const fsMock = createMemoryFs({ [SIDECAR_PATH]: sidecar([]) });
  const graphCalls = [];
  const graph = {
    listDriveChildren: async (_driveId, folderPath) => {
      graphCalls.push(folderPath);
      assert.equal(folderPath, '26-000');
      return [{
        id: 'live-folder-id',
        name: '26-123 - Live Job',
        isFolder: true,
        webUrl: 'https://sharepoint/live',
      }];
    },
  };

  const { resolveJobFolder } = await loadService({ fsMock, graph });
  const result = await resolveJobFolder('26-123');
  const written = fsMock.readJson(SIDECAR_PATH);

  assert.equal(result, '26-000/26-123 - Live Job');
  assert.deepEqual(graphCalls, ['26-000']);
  assert.equal(written.count, 1);
  assert.equal(written.folders[0].jobNumber, '26-123');
  assert.equal(written.folders[0].itemId, 'live-folder-id');
  assert.equal(written.folders[0].folderPath, '26-000/26-123 - Live Job');
  assert.equal(written.folders[0].source, 'runtime-miss');
  assert.equal(fsMock.operations.some((op) => op.op === 'rename' && op.toPath === SIDECAR_PATH), true);
  assert.deepEqual(fsMock.tempFiles(), []);
});

test('service jobs resolve through the Service Jobs year bucket, not NN-000', async () => {
  const fsMock = createMemoryFs({ [SIDECAR_PATH]: sidecar([]) });
  const graphCalls = [];
  const graph = {
    listDriveChildren: async (_driveId, folderPath) => {
      graphCalls.push(folderPath);
      assert.equal(folderPath, 'Service Jobs/2026');
      return [{
        id: 'svc-folder-id',
        name: '26-SVC412 - 4400 Example Dumpsters',
        isFolder: true,
        webUrl: 'https://sharepoint/svc',
      }];
    },
  };

  const { resolveJobFolder } = await loadService({ fsMock, graph });
  const result = await resolveJobFolder('26-SVC412');
  const written = fsMock.readJson(SIDECAR_PATH);

  assert.equal(result, 'Service Jobs/2026/26-SVC412 - 4400 Example Dumpsters');
  assert.deepEqual(graphCalls, ['Service Jobs/2026']);
  assert.equal(written.folders[0].jobNumber, '26-SVC412');
  assert.equal(written.folders[0].folderPath, 'Service Jobs/2026/26-SVC412 - 4400 Example Dumpsters');
});

test('stale sidecar 404 refreshes through live Graph and rewrites entry', async () => {
  const fsMock = createMemoryFs({
    [SIDECAR_PATH]: sidecar([{
      jobNumber: '26-123',
      driveId: 'drive-id',
      itemId: 'old-folder-id',
      folderPath: '26-000/26-123 - Old Job',
      folderName: '26-123 - Old Job',
      webUrl: 'https://sharepoint/old',
      resolvedAt: '2026-07-02T12:00:00.000Z',
      source: 'generated',
    }]),
  });
  const graphCalls = [];
  const graph = {
    listDriveChildren: async (_driveId, folderPath) => {
      graphCalls.push(folderPath);
      if (folderPath === '26-000/26-123 - Old Job') {
        throw new Error('Graph 404 Not Found: itemNotFound');
      }
      if (folderPath === '26-000') {
        return [{
          id: 'new-folder-id',
          name: '26-123 - New Job',
          isFolder: true,
          webUrl: 'https://sharepoint/new',
        }];
      }
      if (folderPath === '26-000/26-123 - New Job') {
        return [{ id: 'billings', name: 'Billings', isFolder: true }];
      }
      return [];
    },
  };

  const { getJobFolderTree } = await loadService({ fsMock, graph });
  const result = await getJobFolderTree('26-123');
  const written = fsMock.readJson(SIDECAR_PATH);

  assert.equal(result.jobFolder, '26-000/26-123 - New Job');
  assert.deepEqual(result.folders, [{ id: 'billings', name: 'Billings', children: [] }]);
  assert.deepEqual(graphCalls, [
    '26-000/26-123 - Old Job',
    '26-000',
    '26-000/26-123 - New Job',
    '26-000/26-123 - New Job/Billings',
  ]);
  assert.equal(written.count, 1);
  assert.equal(written.folders[0].itemId, 'new-folder-id');
  assert.equal(written.folders[0].folderPath, '26-000/26-123 - New Job');
  assert.equal(written.folders[0].source, 'runtime-refresh');
});

test('absent sidecar uses live path and only creates file after successful miss resolution', async () => {
  const fsMock = createMemoryFs();
  const graphCalls = [];
  const graph = {
    listDriveChildren: async (_driveId, folderPath) => {
      graphCalls.push(folderPath);
      if (graphCalls.length === 1) return [];
      return [{
        id: 'created-folder-id',
        name: '26-123 - Created Job',
        isFolder: true,
        webUrl: 'https://sharepoint/created',
      }];
    },
  };

  const { resolveJobFolder } = await loadService({ fsMock, graph });
  const missing = await resolveJobFolder('26-999');

  assert.equal(missing, null);
  assert.equal(fsMock.hasFile(SIDECAR_PATH), false);

  const resolved = await resolveJobFolder('26-123');
  const written = fsMock.readJson(SIDECAR_PATH);

  assert.equal(resolved, '26-000/26-123 - Created Job');
  assert.deepEqual(graphCalls, ['26-000', '26-000']);
  assert.equal(written.count, 1);
  assert.equal(written.folders[0].jobNumber, '26-123');
  assert.equal(written.folders[0].source, 'runtime-miss');
});

test('listFolderContents returns folders and files for lazy SharePoint browse', async () => {
  const fsMock = createMemoryFs();
  const graphCalls = [];
  const graph = {
    listDriveChildren: async (_driveId, folderPath) => {
      graphCalls.push(folderPath);
      return [
        { id: 'folder-1', name: '03 Insurance', isFolder: true, webUrl: 'https://sharepoint/folder' },
        { id: 'file-1', name: 'Existing COI.pdf', isFolder: false, webUrl: 'https://sharepoint/file' },
        { id: 'file-2', name: 'Notes.docx', isFolder: false },
      ];
    },
  };

  const { listFolderChildren, listFolderContents } = await loadService({ fsMock, graph });
  const contents = await listFolderContents('/26-000/./26-434 - Brightwater/../03 Insurance/');

  assert.deepEqual(graphCalls, ['26-000/26-434 - Brightwater/03 Insurance']);
  assert.deepEqual(contents, {
    folders: [{ id: 'folder-1', name: '03 Insurance', hasChildren: null }],
    files: [
      { id: 'file-1', name: 'Existing COI.pdf', webUrl: 'https://sharepoint/file' },
      { id: 'file-2', name: 'Notes.docx', webUrl: null },
    ],
  });

  const foldersOnly = await listFolderChildren('26-000/26-434 - Brightwater');
  assert.deepEqual(foldersOnly, [{ id: 'folder-1', name: '03 Insurance', hasChildren: null }]);
});
