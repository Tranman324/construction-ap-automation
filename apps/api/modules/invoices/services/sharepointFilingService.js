'use strict';
/**
 * SharePoint filing service — real backend for doc-panel filing actions.
 *
 * The NCG Projects site stores each job under a year bucket:
 *   Projects Documents / <YY>-000 / <YY-###> - <Job Name> / <subfolders...>
 *
 * Exposes:
 *   - resolveJobFolder(jobNumber): find the job's folder path in the drive
 *   - getJobFolderTree(jobNumber):  one-level-deep subfolder listing for the
 *     DestinationPicker (replaces the FE's hardcoded tree)
 *   - uploadDocumentToJobFolder(): upload a local file into a chosen subfolder
 *
 * Site/drive reference: memory/reference/msgraph-ncg.md (verified 2026-06-01).
 */

const fs = require('fs');
const path = require('path');
const graph = require('../../../lib/graph');
const logger = require('../../../lib/logger');
const { DATA_DIR } = require('../../../config');
const {
  buildCanonicalFilingFileName,
  isSharePointUploadConflict,
  resolveCanonicalFilenameCollision,
  sanitizeFilenameOverride,
  getTypeAbbreviation,
} = require('./sharepointFilename');
const { resolveFilingValues } = require('./filingValueResolver');

// NCG Projects site — Documents drive (stable id; site structure verified 2026-07-01)
const PROJECTS_DRIVE_ID =
  process.env.SHAREPOINT_PROJECTS_DRIVE_ID ||
  'b!EXAMPLE-DRIVE-ID';

// Job-folder cache: jobNumber → { path, expiresAt }. Folder names include the
// job description suffix ("26-409 - Ferrotek Int. - Riverton") which we discover
// by listing the year bucket. 15-minute TTL keeps Graph traffic low.
const folderCache = new Map();
const FOLDER_CACHE_TTL_MS = 15 * 60_000;
const JOB_FOLDER_SIDECAR_PATH = path.join(DATA_DIR, 'job_sharepoint_folders.json');

function getDocumentVendor(document = {}) {
  return resolveFilingValues(document).vendor.value || '';
}

function getDocumentDate(document = {}) {
  return resolveFilingValues(document).date.value || document.queued_at || document.updated_at || null;
}

function buildUploadFilename({ document = {}, localFilePath, filename, existingNames }) {
  const generated = buildCanonicalFilingFileName(document, localFilePath);
  const extension = path.extname(generated);
  const rawOverride = typeof filename === 'string' ? filename.slice(0, 128) : '';
  const override = sanitizeFilenameOverride(rawOverride);
  const stem = override.toLowerCase().endsWith(extension.toLowerCase())
    ? override.slice(0, -extension.length)
    : override;
  const candidate = stem
    ? `${stem.slice(0, Math.max(1, 128 - extension.length)).replace(/[. ]+$/g, '')}${extension}`
    : generated;
  return resolveCanonicalFilenameCollision(candidate, existingNames);
}

function fileNamesFromChildren(children = []) {
  return children
    .filter((item) => !item.isFolder)
    .map((item) => item.name)
    .filter((name) => typeof name === 'string');
}

/**
 * Upload content using a live listing as the collision authority. Graph can
 * race a listing and reject an otherwise available name; in that case refresh
 * the listing and retry with the next canonical suffix before surfacing the
 * SharePoint error to the best-effort caller.
 */
async function uploadFileToDestination({
  driveId = PROJECTS_DRIVE_ID,
  parentPath,
  localFilePath,
  content,
  document,
  filename,
  existingNames,
}) {
  const bytes = content || fs.readFileSync(localFilePath);
  let names = Array.isArray(existingNames) ? [...existingNames] : fileNamesFromChildren(
    await graph.listDriveChildren(driveId, parentPath)
  );
  let attemptedName = null;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    attemptedName = buildUploadFilename({ document, localFilePath, filename, existingNames: names });
    try {
      const item = await graph.uploadDriveFile(driveId, parentPath, attemptedName, bytes);
      return { ...item, name: item.name || attemptedName };
    } catch (err) {
      if (!isSharePointUploadConflict(err) || attempt === 4) throw err;
      names = fileNamesFromChildren(await graph.listDriveChildren(driveId, parentPath));
      // Protect against an eventually-consistent listing that omits the name
      // we just attempted; the next suffix must still advance.
      names.push(attemptedName);
    }
  }

  throw new Error('Unable to upload SharePoint file after collision retries');
}

function formatMetadataDate(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function buildListItemFields(document = {}) {
  const amount = document.amount == null || document.amount === ''
    ? null
    : Number(document.amount);
  const filingValues = resolveFilingValues(document);

  const fields = {
    DocType: getTypeAbbreviation(document.classification).toUpperCase(),
    JobNumber: filingValues.job.value || null,
    Vendor: getDocumentVendor(document) || null,
    DocDate: formatMetadataDate(getDocumentDate(document)),
    Amount: Number.isFinite(amount) ? amount : null,
    SourceEmail: document.email_from || null,
    ToolboxId: document.id || null,
  };
  if (document.classification === 'warranty') {
    fields.ProviderKind = filingValues.providerKind.value || null;
    fields.WarrantyType = filingValues.warrantyType.value || null;
  }
  return fields;
}

function normalizeJobNumber(jobNumber) {
  return typeof jobNumber === 'string' ? jobNumber.trim().toUpperCase() : '';
}

function isValidJobNumber(jobNumber) {
  return /^\d{2}-(SVC)?\d{3,4}$/i.test(jobNumber);
}

function cacheJobFolderEntry(normalizedJobNumber, entry) {
  folderCache.set(normalizedJobNumber, {
    path: entry.folderPath,
    driveId: entry.driveId || PROJECTS_DRIVE_ID,
    itemId: entry.itemId || null,
    folderName: entry.folderName || path.basename(entry.folderPath || ''),
    webUrl: entry.webUrl || null,
    source: entry.source || 'unknown',
    expiresAt: Date.now() + FOLDER_CACHE_TTL_MS,
  });
}

function readJobFolderSidecar() {
  try {
    const parsed = JSON.parse(fs.readFileSync(JOB_FOLDER_SIDECAR_PATH, 'utf8'));
    if (!parsed || !Array.isArray(parsed.folders)) return null;
    return {
      generatedAt: parsed.generatedAt || null,
      count: parsed.count || parsed.folders.length,
      folders: parsed.folders,
    };
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    logger.warn({
      path: JOB_FOLDER_SIDECAR_PATH,
      error: err && err.message ? err.message : String(err),
    }, 'SharePoint job folder sidecar could not be read');
    return null;
  }
}

function findJobFolderSidecarEntry(normalizedJobNumber) {
  const sidecar = readJobFolderSidecar();
  if (!sidecar) return null;
  return sidecar.folders.find(
    (entry) => normalizeJobNumber(entry.jobNumber) === normalizedJobNumber && entry.folderPath
  ) || null;
}

function writeJobFolderSidecar(sidecar) {
  const serialized = JSON.stringify({
    generatedAt: new Date().toISOString(),
    count: sidecar.folders.length,
    folders: sidecar.folders,
  }, null, 2);
  const tmpPath = `${JOB_FOLDER_SIDECAR_PATH}.tmp-${process.pid}-${Date.now()}`;

  fs.mkdirSync(path.dirname(JOB_FOLDER_SIDECAR_PATH), { recursive: true });
  fs.writeFileSync(tmpPath, serialized);
  fs.renameSync(tmpPath, JOB_FOLDER_SIDECAR_PATH);
}

function upsertJobFolderSidecarEntry(entry) {
  try {
    const sidecar = readJobFolderSidecar() || { generatedAt: null, count: 0, folders: [] };
    const normalizedJobNumber = normalizeJobNumber(entry.jobNumber);
    const nextEntry = {
      jobNumber: normalizedJobNumber,
      driveId: entry.driveId || PROJECTS_DRIVE_ID,
      itemId: entry.itemId || null,
      folderPath: entry.folderPath,
      folderName: entry.folderName || path.basename(entry.folderPath || ''),
      webUrl: entry.webUrl || null,
      resolvedAt: entry.resolvedAt || new Date().toISOString(),
      source: entry.source || 'runtime-miss',
    };
    const existingIndex = sidecar.folders.findIndex(
      (folder) => normalizeJobNumber(folder.jobNumber) === normalizedJobNumber
    );
    if (existingIndex >= 0) {
      sidecar.folders[existingIndex] = { ...sidecar.folders[existingIndex], ...nextEntry };
    } else {
      sidecar.folders.push(nextEntry);
    }
    sidecar.folders.sort((a, b) => normalizeJobNumber(a.jobNumber).localeCompare(normalizeJobNumber(b.jobNumber)));
    writeJobFolderSidecar(sidecar);
  } catch (err) {
    logger.warn({
      path: JOB_FOLDER_SIDECAR_PATH,
      jobNumber: entry.jobNumber,
      error: err && err.message ? err.message : String(err),
    }, 'SharePoint job folder sidecar update failed');
  }
}

function buildJobFolderEntry(normalizedJobNumber, yearBucket, match, source) {
  const folderPath = `${yearBucket}/${match.name}`;
  return {
    jobNumber: normalizedJobNumber,
    driveId: PROJECTS_DRIVE_ID,
    itemId: match.id || null,
    folderPath,
    folderName: match.name,
    webUrl: match.webUrl || null,
    resolvedAt: new Date().toISOString(),
    source,
  };
}

function isGraphNotFoundError(err) {
  const message = err && err.message ? err.message : String(err || '');
  return err?.status === 404
    || err?.code === 'itemNotFound'
    || /Graph\s+404\b/i.test(message)
    || /\b404\b.*not\s*found/i.test(message)
    || /not\s*found/i.test(message);
}

function replaceJobFolderPrefix(folderPath, oldJobFolder, newJobFolder) {
  if (folderPath === oldJobFolder) return newJobFolder;
  if (folderPath.startsWith(`${oldJobFolder}/`)) {
    return `${newJobFolder}/${folderPath.slice(oldJobFolder.length + 1)}`;
  }
  return folderPath;
}

async function stampListItemFields({ driveId = PROJECTS_DRIVE_ID, itemId, document }) {
  if (!itemId || !document) return null;
  const fields = buildListItemFields(document);
  await graph.patchListItemFields(driveId, itemId, fields);
  return fields;
}

/**
 * Parent bucket for a job's folder in the Projects drive. Regular jobs live
 * in year buckets ("26-000"); service jobs live under "Service Jobs/20XX"
 * (e.g. "Service Jobs/2026/26-SVC412 - 4400 Example Dumpsters").
 */
function jobYearBucket(normalizedJobNumber) {
  const yy = normalizedJobNumber.slice(0, 2);
  if (/^\d{2}-SVC\d{3,4}$/i.test(normalizedJobNumber)) return `Service Jobs/20${yy}`;
  return `${yy}-000`;
}

/**
 * Resolve a job number (e.g. "26-409") to its folder path in the Projects
 * drive (e.g. "26-000/26-409 - Ferrotek Int. - Riverton"). Returns null when the
 * job folder does not exist.
 */
async function resolveJobFolderLive(normalized, source = 'runtime-miss') {
  const yearBucket = jobYearBucket(normalized);
  let children;
  try {
    children = await graph.listDriveChildren(PROJECTS_DRIVE_ID, yearBucket);
  } catch (err) {
    logger.warn({ jobNumber: normalized, yearBucket, err: err.message }, 'SharePoint year bucket listing failed');
    return null;
  }

  const match = children.find(
    (c) => c.isFolder && c.name.toUpperCase().startsWith(normalized)
  );
  if (!match) return null;

  const entry = buildJobFolderEntry(normalized, yearBucket, match, source);
  cacheJobFolderEntry(normalized, entry);
  upsertJobFolderSidecarEntry(entry);
  return entry.folderPath;
}

async function resolveJobFolder(jobNumber) {
  const normalized = normalizeJobNumber(jobNumber);
  if (!normalized || !isValidJobNumber(normalized)) return null;

  const cached = folderCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) return cached.path;

  const sidecarEntry = findJobFolderSidecarEntry(normalized);
  if (sidecarEntry) {
    cacheJobFolderEntry(normalized, {
      ...sidecarEntry,
      jobNumber: normalized,
      driveId: sidecarEntry.driveId || PROJECTS_DRIVE_ID,
      source: sidecarEntry.source || 'sidecar',
    });
    return sidecarEntry.folderPath;
  }

  return resolveJobFolderLive(normalized, 'runtime-miss');
}

async function refreshJobFolder(jobNumber) {
  const normalized = normalizeJobNumber(jobNumber);
  if (!normalized || !isValidJobNumber(normalized)) return null;
  folderCache.delete(normalized);
  return resolveJobFolderLive(normalized, 'runtime-refresh');
}

async function listDriveChildrenWithFolderRefresh({ jobNumber, jobFolder, folderPath }) {
  try {
    const children = await graph.listDriveChildren(PROJECTS_DRIVE_ID, folderPath);
    return { children, jobFolder, folderPath };
  } catch (err) {
    if (!isGraphNotFoundError(err) || !jobNumber || !jobFolder) throw err;

    const refreshedJobFolder = await refreshJobFolder(jobNumber);
    if (!refreshedJobFolder) throw err;

    const refreshedPath = replaceJobFolderPrefix(folderPath, jobFolder, refreshedJobFolder);
    const children = await graph.listDriveChildren(PROJECTS_DRIVE_ID, refreshedPath);
    return { children, jobFolder: refreshedJobFolder, folderPath: refreshedPath };
  }
}

/**
 * List a job's subfolders (one level deep, folders only) for the
 * DestinationPicker. Returns { jobNumber, jobFolder, folders } or null when
 * the job folder is missing.
 */
async function getJobFolderTree(jobNumber) {
  const normalizedJobNumber = normalizeJobNumber(jobNumber);
  let jobFolder = await resolveJobFolder(jobNumber);
  if (!jobFolder) return null;

  const listed = await listDriveChildrenWithFolderRefresh({
    jobNumber: normalizedJobNumber,
    jobFolder,
    folderPath: jobFolder,
  });
  jobFolder = listed.jobFolder;
  const children = listed.children;
  const folders = [];
  for (const child of children.filter((c) => c.isFolder)) {
    let subChildren = [];
    try {
      const grandchildren = await graph.listDriveChildren(PROJECTS_DRIVE_ID, `${jobFolder}/${child.name}`);
      subChildren = grandchildren
        .filter((c) => c.isFolder)
        .map((c) => ({ id: c.id, name: c.name, children: [] }));
    } catch {
      // Second level is best-effort; a top-level-only tree is still useful.
    }
    folders.push({ id: child.id, name: child.name, children: subChildren });
  }

  return { jobNumber: normalizedJobNumber, jobFolder, folders };
}

/**
 * Upload a document's local file into a subfolder of its job folder.
 *
 * @param {object} opts
 * @param {string} opts.jobNumber   - e.g. "26-409"
 * @param {string} opts.destination - subfolder path relative to the job folder
 *                                    (e.g. "Billings" or "Closeouts/Warranties");
 *                                    '' files into the job root
 * @param {string} opts.localFilePath - absolute path of the file on disk
 * @param {string} [opts.fileName]  - override upload name
 * @param {object} [opts.document]  - document row used for generated name and metadata
 * @returns {{id, webUrl, name, destinationPath, metadataWarning}} upload result
 * @throws when the job folder can't be resolved or the upload fails
 */
async function uploadDocumentToJobFolder({ jobNumber, destination = '', localFilePath, fileName, document }) {
  const normalizedJobNumber = normalizeJobNumber(jobNumber);
  let jobFolder = await resolveJobFolder(jobNumber);
  if (!jobFolder) {
    const err = new Error(`No SharePoint folder found for job ${jobNumber}`);
    err.code = 'JOB_FOLDER_NOT_FOUND';
    throw err;
  }
  if (!localFilePath || !fs.existsSync(localFilePath)) {
    const err = new Error('Document file is missing on disk');
    err.code = 'LOCAL_FILE_MISSING';
    throw err;
  }

  // Destination is validated against the live folder listing to prevent
  // path injection ("../..") and uploads into nonexistent folders.
  const cleanDestination = String(destination || '')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..')
    .join('/');

  let parentPath = jobFolder;
  if (cleanDestination) {
    let currentPath = jobFolder;
    for (const segment of cleanDestination.split('/')) {
      const listed = await listDriveChildrenWithFolderRefresh({
        jobNumber: normalizedJobNumber,
        jobFolder,
        folderPath: currentPath,
      });
      jobFolder = listed.jobFolder;
      currentPath = listed.folderPath;
      const children = listed.children;
      const found = children.find(
        (c) => c.isFolder && c.name.toLowerCase() === segment.toLowerCase()
      );
      if (!found) {
        const err = new Error(`Destination folder "${segment}" not found under ${currentPath}`);
        err.code = 'DESTINATION_NOT_FOUND';
        throw err;
      }
      currentPath = `${currentPath}/${found.name}`;
    }
    parentPath = currentPath;
  }

  const parentListing = await listDriveChildrenWithFolderRefresh({
    jobNumber: normalizedJobNumber,
    jobFolder,
    folderPath: parentPath,
  });
  parentPath = parentListing.folderPath;
  const existingNames = fileNamesFromChildren(parentListing.children);
  const item = await uploadFileToDestination({
    driveId: PROJECTS_DRIVE_ID,
    parentPath,
    localFilePath,
    filename: fileName,
    document,
    existingNames,
  });
  let metadataWarning = null;

  try {
    await stampListItemFields({ driveId: PROJECTS_DRIVE_ID, itemId: item.id, document });
  } catch (err) {
    metadataWarning = err.message;
    logger.warn({
      jobNumber,
      destinationPath: parentPath,
      itemId: item.id,
      error: err.message,
    }, 'SharePoint metadata stamping failed during filing');
  }

  logger.info(
    { jobNumber, destinationPath: parentPath, fileName: item.name, itemId: item.id, webUrl: item.webUrl },
    'Document uploaded to SharePoint'
  );

  return { id: item.id, webUrl: item.webUrl, name: item.name, destinationPath: parentPath, metadataWarning };
}

function cleanDriveRelativePath(relPath = '') {
  return String(relPath)
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..')
    .join('/');
}

function mapFolderChild(child) {
  return { id: child.id, name: child.name, hasChildren: null };
}

function mapFileChild(child) {
  return { id: child.id, name: child.name, webUrl: child.webUrl || null };
}

/**
 * List one level of folder contents at an arbitrary drive-relative path.
 * Used by the DestinationPicker's lazy-browse mode.
 *
 * @param {string} relPath - drive-relative folder path ('' = drive root)
 * @returns {{folders: Array<{id, name, hasChildren: null}>, files: Array<{id, name, webUrl: string | null}>}}
 * @throws when the path doesn't exist or Graph call fails
 */
async function listFolderContents(relPath = '') {
  const cleaned = cleanDriveRelativePath(relPath);
  const children = await graph.listDriveChildren(PROJECTS_DRIVE_ID, cleaned);
  return {
    folders: children.filter((c) => c.isFolder).map(mapFolderChild),
    files: children.filter((c) => c.isFile || !c.isFolder).map(mapFileChild),
  };
}

/**
 * Backward-compatible folder-only listing for existing callers.
 *
 * @param {string} relPath - drive-relative folder path ('' = drive root)
 * @returns {Array<{id, name, hasChildren: null}>} folders only, one level
 */
async function listFolderChildren(relPath = '') {
  const contents = await listFolderContents(relPath);
  return contents.folders;
}

module.exports = {
  resolveJobFolder,
  getJobFolderTree,
  uploadDocumentToJobFolder,
  uploadFileToDestination,
  listFolderChildren,
  listFolderContents,
  buildListItemFields,
  buildUploadFilename,
  stampListItemFields,
  PROJECTS_DRIVE_ID,
};
