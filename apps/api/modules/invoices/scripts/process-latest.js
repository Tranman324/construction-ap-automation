#!/usr/bin/env node
/**
 * Process latest N emails from invoices inbox (regardless of read status)
 * Usage: node process-latest.js [count]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const graph = require('../../../lib/graph');
const { matchVendor, matchSubcontract, parseJobReference } = require('../services/matcher');
const { INCOMING_DIR, INVOICE_MAILBOX: SHARED_MAILBOX } = require('../../../config');

async function graphFetch(urlPath) {
  return graph.graphFetch(urlPath);
}

async function markUnread(messageId) {
  await graph.markUnread(SHARED_MAILBOX, messageId);
}

function convertFirstPdfPage(filePath, imagePath) {
  execFileSync('convert', ['-density', '200', `${filePath}[0]`, '-quality', '95', imagePath], {
    timeout: 30000,
  });
}

async function classifyWithHaiku(imagePath) {
  const imageData = fs.readFileSync(imagePath).toString('base64');
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageData } },
          {
            type: 'text',
            text: `Classify this document as: invoice, receipt, statement, coi, w9, or other.
If invoice, extract all fields. Return ONLY valid JSON:
{
  "classification": "invoice|receipt|statement|coi|w9|other",
  "vendorName": "Company name",
  "vendorAddress": "Full address or null",
  "invoiceNumber": "Invoice # or null",
  "invoiceDate": "YYYY-MM-DD or null",
  "dueDate": "YYYY-MM-DD or null",
  "amount": 0.00,
  "jobNumber": "Job/project # like 25-554 or null",
  "description": "Brief summary of document"
}
For non-invoices, still return classification + vendorName + description. Use null for unknown fields.`,
          },
        ],
      }],
    }),
  });

  if (!resp.ok) throw new Error(`Haiku ${resp.status}: ${await resp.text()}`);
  const result = await resp.json();
  const text = result.content?.[0]?.text || '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Could not parse Haiku response');
  return JSON.parse(match[0]);
}

async function run() {
  const count = parseInt(process.argv[2]) || 5;

  const data = await graphFetch(
    `/users/${SHARED_MAILBOX}/mailFolders/inbox/messages?$top=${count}&$orderby=receivedDateTime desc&$select=id,subject,from,receivedDateTime,hasAttachments`
  );

  const results = [];

  for (const email of (data.value || [])) {
    const from = email.from?.emailAddress?.address || '';
    const subject = email.subject || '';
    console.error(`\nProcessing: "${subject}" from ${from}`);

    if (!email.hasAttachments) {
      results.push({ subject, from, date: email.receivedDateTime, classification: 'no-attachment' });
      continue;
    }

    const msgDir = path.join(INCOMING_DIR, email.id.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 50));
    fs.mkdirSync(msgDir, { recursive: true });

    const attData = await graphFetch(`/users/${SHARED_MAILBOX}/messages/${email.id}/attachments`);

    for (const att of (attData.value || [])) {
      if (att['@odata.type'] !== '#microsoft.graph.fileAttachment') continue;
      const filePath = path.join(msgDir, att.name);
      fs.writeFileSync(filePath, Buffer.from(att.contentBytes, 'base64'));

      const ext = path.extname(att.name).toLowerCase();
      const stats = fs.statSync(filePath);

      // Skip tiny images (email signatures)
      if (['.jpg', '.jpeg', '.png', '.gif'].includes(ext) && stats.size < 50000) continue;

      // Skip unsupported
      if (!['.pdf', '.jpg', '.jpeg', '.png'].includes(ext)) {
        results.push({ subject, from, date: email.receivedDateTime, file: att.name, classification: 'unsupported' });
        continue;
      }

      // Convert PDF to image
      let imagePath = filePath;
      let tmpImage = null;
      if (ext === '.pdf') {
        tmpImage = `/tmp/proc_${Date.now()}.png`;
        try {
          convertFirstPdfPage(filePath, tmpImage);
          imagePath = tmpImage;
        } catch (e) {
          results.push({ subject, from, date: email.receivedDateTime, file: att.name, classification: 'error', note: 'PDF convert failed' });
          continue;
        }
      }

      // Classify + extract
      console.error(`  Classifying: ${att.name}`);
      try {
        const extracted = await classifyWithHaiku(imagePath);

        const entry = {
          subject,
          from,
          date: email.receivedDateTime,
          file: att.name,
          ...extracted,
        };

        // Match vendor + subcontract for invoices
        if (extracted.classification === 'invoice') {
          const vm = matchVendor({ name: extracted.vendorName, email: from, address: extracted.vendorAddress });
          entry.vendorCode = vm.vendorCode;
          entry.vendorCodeConfidence = vm.confidence;
          entry.vendorMatchMethod = vm.method;
          entry.spectrumVendorName = vm.vendorName;

          // Parse job reference: YY-### = job, YY-###.## = subcontract
          const parsed = parseJobReference(extracted.jobNumber);
          entry.jobNumber = parsed.jobNumber;

          if (parsed.subcontractNumber) {
            // Invoice already has full subcontract number
            entry.subcontractNumber = parsed.subcontractNumber;
            entry.subcontractConfidence = 0.99;
            entry.subcontractMethod = 'extracted-direct';
          } else if (vm.vendorCode && parsed.jobNumber) {
            const sm = matchSubcontract(vm.vendorCode, parsed.jobNumber);
            entry.subcontractNumber = sm.subcontractNumber;
            entry.subcontractConfidence = sm.confidence;
            entry.subcontractMethod = sm.method;
          }
        }

        results.push(entry);
        console.error(`  → ${extracted.classification} | ${extracted.vendorName || 'n/a'} | $${extracted.amount || 'n/a'}`);
      } catch (e) {
        results.push({ subject, from, date: email.receivedDateTime, file: att.name, classification: 'error', note: e.message.slice(0, 100) });
      }

      // Cleanup temp
      if (tmpImage) try { fs.unlinkSync(tmpImage); } catch {}
    }

    // Mark back to unread
    await markUnread(email.id);
  }

  console.log(JSON.stringify(results, null, 2));
}

if (require.main === module) {
  run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
}

module.exports = { convertFirstPdfPage, run };
