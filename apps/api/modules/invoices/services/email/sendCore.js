'use strict';
const { graphCall } = require('./graphCall');
const { EmailError } = require('./errors');
// Draft/prepend/attachment mechanics copied from waiverRequestService; no shared transport refactor.
// Immutable draft ID identifies the exact sent copy (Microsoft Graph outlook-immutable-id).
async function sendCore({ graph, outbox, logger, config, doc, kind, message, recipients, file, attemptId, actorId }) {
  const context = { attemptId, kind, docId: doc.id, actorId };
  logger.info({ operation: 'email.send_attempt', ...context, status: 'pending', code: 'EMAIL_SEND_ATTEMPT' }, 'Email send attempted');
  const base = `/users/${encodeURIComponent(config.mailbox)}/messages`;
  let draft; let sendStarted = false; let sendAccepted = false; let confirmed = false;
  const call = (url, options, timeout) => graphCall(graph, url, options, timeout);
  try {
    draft = await call(kind === 'reply' ? `${base}/${encodeURIComponent(doc.email_message_id)}/createReply` : base,
      { method: 'POST', body: JSON.stringify({}) });
    if (!draft?.id) throw new Error('Missing draft identifier');
    await outbox.draft(attemptId, draft);
    const url = `${base}/${encodeURIComponent(draft.id)}`;
    const quoted = draft.body?.contentType?.toLowerCase() === 'text'
      ? `<p>${(draft.body.content || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])).replace(/\r?\n/g, '<br>')}</p>`
      : (draft.body?.content || '');
    await call(url, { method: 'PATCH', body: JSON.stringify({ subject: message.subject,
      body: { contentType: 'HTML', content: message.html + quoted },
      toRecipients: recipients.map(address => ({ emailAddress: { address } })), ccRecipients: [], bccRecipients: [],
      replyTo: [{ emailAddress: { address: config.mailbox } }],
    }) });
    if (file) await call(`${url}/attachments`, { method: 'POST', body: JSON.stringify(file) }, 60000);
    await outbox.started(attemptId);
    sendStarted = true;
    await call(`${url}/send`, { method: 'POST' });
    sendAccepted = true;
    // 202 only accepts delivery work. Graph sometimes needs time to process the sent copy.
    // Retry up to 3 times with 1s between attempts; no subject/time inference.
    const confirmSelect = `${url}?$select=id,isDraft,internetMessageId,conversationId,sentDateTime`;
    let sent;
    for (let confirmAttempt = 0; confirmAttempt < 3; confirmAttempt++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      sent = await call(confirmSelect);
      if (sent?.id === draft.id && sent.isDraft === false && sent.internetMessageId && sent.sentDateTime) {
        break;
      }
      if (confirmAttempt === 2) {
        throw new Error('Sent copy is not yet available');
      }
      logger.info({ operation: 'email.confirm_retry', ...context, attempt: confirmAttempt + 1 }, 'Confirmation GET returned incomplete; retrying');
    }
    confirmed = true;
    try { await outbox.finish(attemptId, 'confirmed', sent); }
    catch { logger.error({ operation: 'email.confirmation_persist_failed', ...context, status: 'confirmed', code: 'EMAIL_CONFIRMATION_PERSIST_FAILED' }, 'Confirmed email recording failed'); }
    logger.info({ operation: 'email.send_outcome', ...context, status: 'confirmed', code: 'EMAIL_SEND_CONFIRMED' }, 'Email send confirmed');
    return sent;
  } catch (err) {
    // Only explicit client rejection of send is definite; 5xx/network/timeout may have sent.
    const definiteRejection = !sendAccepted && /^Graph 4\d\d\b/.test(err.message || '') && !/^Graph 408\b/.test(err.message || '');
    const ambiguous = sendStarted && !confirmed && !definiteRejection;
    // Graph accepted the send (202): the message will go out. Record ambiguous and
    // return success — the pipeline reconciliation sweep re-checks Graph and flips
    // the attempt to confirmed (emitting the audit event) within its next cycle.
    if (sendAccepted && !confirmed) {
      try { await outbox.finish(attemptId, 'ambiguous'); }
      catch { logger.error({ operation: 'email.outcome_persist_failed', ...context, status: 'ambiguous', code: 'EMAIL_OUTCOME_PERSIST_FAILED' }, 'Email outcome recording failed'); }
      logger.info({ operation: 'email.send_outcome', ...context, status: 'ambiguous', code: 'EMAIL_SEND_PENDING_CONFIRMATION' }, 'Email send accepted; confirmation deferred to reconciliation sweep');
      return { pending: true };
    }
    // A failed post-send GET (including 404) cannot prove the earlier send failed.
    const status = ambiguous ? 'ambiguous' : 'failed';
    const code = ambiguous ? 'EMAIL_SEND_AMBIGUOUS' : 'EMAIL_SEND_FAILED';
    const graphStatus = /^Graph (\d{3})\b/.exec(err.message || '')?.[1];
    if (draft?.id && !ambiguous) {
      try { await call(`${base}/${encodeURIComponent(draft.id)}`, { method: 'DELETE' }); }
      catch { logger.warn({ operation: 'email.draft_cleanup_failed', ...context, status, code: 'EMAIL_DRAFT_CLEANUP_FAILED' }, 'Email draft cleanup failed'); }
    }
    try { await outbox.finish(attemptId, status); }
    catch { logger.error({ operation: 'email.outcome_persist_failed', ...context, status, code: 'EMAIL_OUTCOME_PERSIST_FAILED' }, 'Email outcome recording failed'); }
    logger.warn({ operation: 'email.send_outcome', ...context, status, code,
      ...(graphStatus ? { graphStatus: Number(graphStatus) } : {}),
      ...(err.code === 'EMAIL_TRANSPORT_TIMEOUT' ? { transportCode: err.code } : {}),
    }, 'Email send did not confirm');
    throw new EmailError(502, ambiguous ? 'Email may have sent; check activity before retrying' : 'Email send failed',
      code, { attemptId });
  }
}
module.exports = { sendCore };
