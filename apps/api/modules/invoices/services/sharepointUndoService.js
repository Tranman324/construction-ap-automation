'use strict';

const { deleteDriveItem } = require('../../../lib/graph');
const { PROJECTS_DRIVE_ID } = require('./sharepointFilingService');

async function deleteFiledSharePointCopy({ row, req, operation }) {
  const itemId = row?.sharepoint_item_id;
  if (!itemId) return null;

  try {
    await deleteDriveItem(PROJECTS_DRIVE_ID, itemId);
    return {
      deleted: true,
      itemId,
      driveId: PROJECTS_DRIVE_ID,
    };
  } catch (err) {
    const warning = err && err.message ? err.message : String(err);
    if (req?.log?.warn) {
      req.log.warn({
        operation,
        context: { invoiceId: row.id, itemId, driveId: PROJECTS_DRIVE_ID },
        error: warning,
      }, 'SharePoint filed copy delete failed');
    }

    return {
      deleted: false,
      itemId,
      driveId: PROJECTS_DRIVE_ID,
      warning,
    };
  }
}

module.exports = {
  deleteFiledSharePointCopy,
};
