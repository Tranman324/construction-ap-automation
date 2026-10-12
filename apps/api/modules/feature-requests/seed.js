#!/usr/bin/env node
/**
 * Seed script — Feature Request Board
 * Inserts the real Toolbox 3.0 feature requests for employee voting.
 * Safe to run multiple times (checks for existing data).
 *
 * Usage: node scripts/feature-requests/seed.js
 * Reset: node scripts/feature-requests/seed.js --reset
 */

'use strict';

const pool = require('../invoices/scripts/db');

// Author lookup
const AUTHORS = {
  owner: { email: 'Amorgan@Northwindcg.example', name: 'Alex Morgan' },
  josh: { email: 'ohartley@Northwindcg.example', name: 'Owen Hartley' },
  joe: { email: 'mreyes@Northwindcg.example', name: 'Marco Reyes' },
  dana: { email: 'dwhitfield@Northwindcg.example', name: 'Dana Whitfield' },
};

const REQUESTS = [
  {
    title: 'Interactive Project Map',
    description: 'See all your projects on a map, color-coded by health status. Click a pin to jump to that project. Clusters together when zoomed out, separates when you zoom in.',
    category: 'design',
    status: 'in_progress',
    author: 'owner',
  },
  {
    title: 'Gantt Schedule View',
    description: 'View all projects on a timeline with bars showing start-to-finish. Group by superintendent to see workload. Right-click to reassign supers. Highlights projects running past their end date.',
    category: 'reporting',
    status: 'in_progress',
    author: 'josh',
  },
  {
    title: 'Dashboard Stats & Quick Actions',
    description: 'At-a-glance numbers when you log in: active projects, pending approvals, items needing attention, checklists incomplete. One-click buttons to jump to common tasks.',
    category: 'reporting',
    status: 'in_progress',
    author: 'owner',
  },
  {
    title: 'Search & Notifications',
    description: 'Search across all projects, subs, and documents from anywhere. Bell icon shows things that need your attention — overdue items, new approvals, flags raised.',
    category: 'design',
    status: 'open',
    author: 'owner',
  },
  {
    title: 'Project Creation Wizard',
    description: 'Step-by-step job setup: enter project details, assign the team, set up phase codes, add billing items, review everything, and submit for approval. System validates as you go.',
    category: 'workflow',
    status: 'completed',
    author: 'owner',
  },
  {
    title: 'Approval Workflow',
    description: 'Review submitted job setups. Approve (auto-assigns job number and pushes to Spectrum), reject with a reason, or request changes with notes. Soft delete for mistakes.',
    category: 'workflow',
    status: 'completed',
    author: 'owner',
  },
  {
    title: 'Onboarding Checklist',
    description: 'After a project is approved, a checklist guides what needs to happen next: Paycom setup, team contacts, permits (if applicable), contract status. Items can be marked N/A. Leadership can bypass when needed.',
    category: 'workflow',
    status: 'open',
    author: 'owner',
  },
  {
    title: 'AI Project Summary',
    description: "A short, auto-generated paragraph on each project telling you what's happening — pulled from financials, schedule, flags, and recent activity. Updated automatically.",
    category: 'integration',
    status: 'open',
    author: 'owner',
  },
  {
    title: 'Field Checklists & Photo Capture',
    description: 'Superintendents complete checklists on iPad: Mobilization, Interior Buildout, Final Inspections. Some items require a photo before you can check them off. Photos are geotagged. System logs who completed each item and when.',
    category: 'workflow',
    status: 'open',
    author: 'owner',
  },
  {
    title: 'Quality Checks',
    description: 'Rate each project weekly across 4 categories (Safety, Site Conditions, Issues, General). Add notes, photos, action items. History is saved so you can see trends over time.',
    category: 'workflow',
    status: 'open',
    author: 'owner',
  },
  {
    title: 'Subcontractor Tracking',
    description: "See all subs on a project: who they are, what they were contracted for, what they've billed, what's outstanding. Track subcontract status from \"Not Started\" through \"Signed & Active.\" See closeout doc status per sub.",
    category: 'reporting',
    status: 'open',
    author: 'owner',
  },
  {
    title: 'Document Management & SharePoint Migration',
    description: 'All project documents in one place — organized by category (Permits, Contracts, Photos, Closeout, etc.). Replaces Box with SharePoint (already included in our Microsoft licenses). Search across all files.',
    category: 'integration',
    status: 'open',
    author: 'owner',
  },
  {
    title: 'Closeout Tracking & Auto-Generated Docs',
    description: "Track every closeout item per project: general checklist, lien waivers, trade documents. Collect docs progressively throughout the project — not all at the end. System auto-generates standard letters (warranty, acceptance) from project data. Defaults to full closeout.",
    category: 'workflow',
    status: 'open',
    author: 'owner',
  },
  {
    title: 'Automated Health Flags',
    description: "System automatically raises red/yellow flags: unsigned sub who's been paid, failed inspection, missing permit past 7 days, closeout not started in late phases. Each flag has a resolve button with a timestamp.",
    category: 'admin',
    status: 'open',
    author: 'owner',
  },
  {
    title: 'Superintendent Dashboard',
    description: "A roll-up view for Eddie showing all supers and their checklist progress across every project. Drill into any super to see exactly what's incomplete. Useful for accountability and performance reviews.",
    category: 'reporting',
    status: 'open',
    author: 'owner',
  },
  {
    title: 'Project Email Feed',
    description: 'See all emails related to a project in one scrollable feed — without digging through Outlook. Click any email to open it. Useful for tracking closeout correspondence, sub communications, and getting up to speed on a project fast.',
    category: 'integration',
    status: 'open',
    author: 'joe',
  },
  {
    title: 'AR / Past-Due Invoices Per Project',
    description: "See what's been billed and what's past due on every project — right on the dashboard. No more running separate reports. PMs always know where they stand on collections.",
    category: 'reporting',
    status: 'open',
    author: 'dana',
  },
  {
    title: 'Permit Tracker',
    description: "Track permit status per project: Is this job permitted? Who's handling it? What's the status? Options: Not Started / In Progress / Already Done / N/A / Owner Handles. System suggests the right permit office based on the project address.",
    category: 'workflow',
    status: 'open',
    author: 'owner',
  },
  {
    title: 'PM Home Page',
    description: "When a PM logs in, they see their projects, their open action items, their overdue closeouts, and anything flagged. Personalized — you only see what's yours unless you're leadership.",
    category: 'design',
    status: 'open',
    author: 'josh',
  },
  {
    title: 'Spectrum Sync',
    description: 'Keep Toolbox and Spectrum in sync. If a PM changes in Spectrum, it updates here. When a job is approved, data pushes to Spectrum automatically. Billing and cost data pulls back in for dashboards.',
    category: 'integration',
    status: 'open',
    author: 'owner',
  },
  {
    title: 'Bid-to-Billing Import',
    description: "Import Frasier's bid cover sheet directly into the billing/schedule of values step. Creates a built-in check: \"your bid says this — does the billing match?\" Reduces re-typing and catches mismatches early.",
    category: 'workflow',
    status: 'open',
    author: 'josh',
  },
  {
    title: 'Meeting Notes → Action Items',
    description: "Record a morning meeting, get it transcribed, and have action items automatically assigned to the right projects. Say someone's name and the task, and it shows up on their project dashboard.",
    category: 'integration',
    status: 'open',
    author: 'owner',
  },
  {
    title: 'Paycom Integration',
    description: 'Automatically create job codes in Paycom when a project is approved. Pull time card data and headcounts. No more manual entry for every new job.',
    category: 'integration',
    status: 'open',
    author: 'owner',
  },
];

// No votes yet — board starts fresh for employees to vote on
const VOTES = [];

async function seed() {
  const reset = process.argv.includes('--reset');

  if (reset) {
    console.log('🗑️  Resetting feature requests...');
    await pool.query('DELETE FROM feature_votes');
    await pool.query('DELETE FROM feature_requests');
    console.log('  ✅ Cleared all existing data');
  } else {
    const { rows } = await pool.query('SELECT COUNT(*) FROM feature_requests');
    if (parseInt(rows[0].count) > 0) {
      console.log(`⚠️  feature_requests already has ${rows[0].count} rows. Use --reset to replace.`);
      process.exit(0);
    }
  }

  console.log('Seeding feature requests...');

  // Insert requests with per-feature authors
  const requestIds = [];
  for (const r of REQUESTS) {
    const author = AUTHORS[r.author];
    const { rows: inserted } = await pool.query(
      `INSERT INTO feature_requests (title, description, category, status, author_email, author_name)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [r.title, r.description, r.category, r.status, author.email, author.name]
    );
    requestIds.push(inserted[0].id);
  }
  console.log(`  ✅ Inserted ${requestIds.length} feature requests`);

  // Insert votes (if any)
  let voteCount = 0;
  for (const v of VOTES) {
    await pool.query(
      `INSERT INTO feature_votes (feature_request_id, user_email, user_name, vote_type)
       VALUES ($1, $2, $3, $4)`,
      [requestIds[v.reqIdx], v.email, v.name, v.type]
    );
    voteCount++;
  }
  if (voteCount > 0) console.log(`  ✅ Inserted ${voteCount} votes`);

  console.log('\n🎉 Seed complete!');
  console.log(`   ${requestIds.length} requests, ${voteCount} votes`);
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
