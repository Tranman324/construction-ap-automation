/**
 * NCG Invoice Pipeline — Microsoft Graph Client
 * Self-contained Graph API client using MSAL client credentials flow.
 * Reads credentials from the pipeline's own .env (MS_TENANT_ID, MS_CLIENT_ID,
 * MS_CLIENT_SECRET, INVOICE_MAILBOX).
 *
 * Implements ONLY what the invoice pipeline needs:
 *   - checkInbox(mailbox, opts)     — list unread messages
 *   - getMessage(mailbox, msgId)    — fetch a single message
 *   - getAttachments(mailbox, msgId) — list attachments
 *   - downloadAttachment(mailbox, msgId, attId) — get contentBytes
 *   - markUnread(mailbox, msgId)    — set isRead=false
 */

'use strict';

const path = require('path');

// Load pipeline .env
try {
  const envPath = path.join(__dirname, '..', '.env');
  const fs = require('fs');
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (match && !process.env[match[1].trim()]) {
      process.env[match[1].trim()] = match[2].trim();
    }
  }
} catch {}

const msal = require('@azure/msal-node');

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default';

// ─── MSAL singleton ──────────────────────────────────────────────────────────
let _cca = null;

function getCCA() {
  if (!_cca) {
    const tenantId = process.env.MS_TENANT_ID;
    const clientId = process.env.MS_CLIENT_ID;
    const clientSecret = process.env.MS_CLIENT_SECRET;

    if (!tenantId || !clientId || !clientSecret) {
      throw new Error('Missing MS_TENANT_ID, MS_CLIENT_ID, or MS_CLIENT_SECRET in environment');
    }

    _cca = new msal.ConfidentialClientApplication({
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        clientSecret,
      },
    });
  }
  return _cca;
}

// ─── Token cache ─────────────────────────────────────────────────────────────
let _token = null;
let _tokenExpiry = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const cca = getCCA();
  const result = await cca.acquireTokenByClientCredential({ scopes: [GRAPH_SCOPE] });
  _token = result.accessToken;
  // expires_in is in seconds; cache with 60s buffer
  _tokenExpiry = Date.now() + ((result.expiresOn ? (result.expiresOn.getTime() - Date.now()) : 3600000) - 60000);
  return _token;
}

// ─── Core fetch helper ────────────────────────────────────────────────────────
async function graphFetch(urlPath, opts = {}) {
  const token = await getToken();
  const url = urlPath.startsWith('http') ? urlPath : `${GRAPH_BASE}${urlPath}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });

  if (res.status === 204) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph ${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * List messages from the inbox.
 * @param {string} mailbox - e.g. 'invoices@northwindcg.example'
 * @param {object} opts
 * @param {boolean} opts.unreadOnly - filter to isRead=false (default true)
 * @param {number} opts.top - max messages to return (default 50)
 * @param {boolean} opts.allMessages - if true, skip isRead filter (for re-processing)
 */
async function checkInbox(mailbox, opts = {}) {
  const unreadOnly = opts.unreadOnly !== false && !opts.allMessages;
  const top = opts.top || 50;
  const filter = unreadOnly ? '&$filter=isRead eq false' : '';
  const select = '$select=id,subject,from,receivedDateTime,isRead,bodyPreview,body,hasAttachments';
  const url = `/users/${mailbox}/mailFolders/inbox/messages?$top=${top}&$orderby=receivedDateTime desc&${select}${filter}`;
  const data = await graphFetch(url);
  return data.value || [];
}

/**
 * Fetch a single message.
 */
async function getMessage(mailbox, messageId) {
  return graphFetch(`/users/${mailbox}/messages/${messageId}`);
}

/**
 * List attachments for a message. Returns the value array.
 */
async function getAttachments(mailbox, messageId) {
  const data = await graphFetch(`/users/${mailbox}/messages/${messageId}/attachments`);
  return data.value || [];
}

/**
 * Download a specific attachment by ID. Returns the attachment object (with contentBytes).
 */
async function downloadAttachment(mailbox, messageId, attachmentId) {
  return graphFetch(`/users/${mailbox}/messages/${messageId}/attachments/${attachmentId}`);
}

/**
 * Mark a message as unread (isRead = false).
 * Hard rule: pipeline always restores unread state so the inbox stays visible.
 */
async function markUnread(mailbox, messageId) {
  await graphFetch(`/users/${mailbox}/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ isRead: false }),
  });
}

// ─── SharePoint Drive helpers ──────────────────────────────────────────────────────────────

/**
 * List children (folders/files) at a path inside a drive.
 * @param {string} driveId
 * @param {string} folderPath - '' for root, or 'A/B/C' (no leading slash)
 * @returns {Array<{name, id, isFolder, isFile, webUrl}>}
 */
async function listDriveChildren(driveId, folderPath = '') {
  const encoded = folderPath
    ? `root:/${folderPath.split('/').map(encodeURIComponent).join('/')}:`
    : 'root';
  const data = await graphFetch(
    `/drives/${driveId}/${encoded}/children?$top=500&$select=id,name,folder,file,webUrl`
  );
  return (data.value || []).map((item) => ({
    id: item.id,
    name: item.name,
    isFolder: Boolean(item.folder),
    isFile: Boolean(item.file),
    webUrl: item.webUrl || null,
  }));
}

/**
 * Upload a file (< 250MB uses simple PUT; Graph small-upload limit is 250MB,
 * our invoice PDFs are far below that) to a drive path. Creates intermediate
 * folders implicitly? No — Graph requires the parent folder to exist; callers
 * should pick paths from listDriveChildren.
 * @param {string} driveId
 * @param {string} folderPath - parent folder path inside the drive ('' = root)
 * @param {string} fileName
 * @param {Buffer} content
 * @returns {{id, name, webUrl}} uploaded driveItem
 */
async function uploadDriveFile(driveId, folderPath, fileName, content) {
  const parts = [...(folderPath ? folderPath.split('/') : []), fileName]
    .map(encodeURIComponent)
    .join('/');
  const token = await getToken();
  const res = await fetch(
    `${GRAPH_BASE}/drives/${driveId}/root:/${parts}:/content?@microsoft.graph.conflictBehavior=rename`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
      },
      body: content,
    }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Graph upload ${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
  }
  const item = await res.json();
  return { id: item.id, name: item.name, webUrl: item.webUrl || null };
}

async function deleteDriveItem(driveId, itemId) {
  return graphFetch(`/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`, {
    method: 'DELETE',
  });
}

async function patchListItemFields(driveId, itemId, fields) {
  return graphFetch(
    `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/listItem/fields`,
    {
      method: 'PATCH',
      body: JSON.stringify(fields || {}),
    }
  );
}

module.exports = {
  checkInbox,
  getMessage,
  getAttachments,
  downloadAttachment,
  markUnread,
  listDriveChildren,
  uploadDriveFile,
  deleteDriveItem,
  patchListItemFields,
  // Expose raw fetch for any one-off needs
  graphFetch,
  getToken,
};
