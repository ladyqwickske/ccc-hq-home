// ccc-hq.com seasonal kingdom sign-ups (the form at ccc-hq.com/signup.html).
//
//   GET  /health            liveness check
//   GET  /status            { open, season } — the form shows whether sign-ups are open
//   GET  /members?clan=…    the member names of one clan, for the form's name list. Fetched
//                           here from the clan's Worker, so the visitor's browser never calls
//                           the clan Workers itself (Cloudflare's managed WordPress rule blocked
//                           some browsers' POSTs to them as an attack).
//   POST /signup            the form (public, CORS open): checks every answer and that the
//                           member is on their clan's member list, then saves it. Signing up
//                           again (same season, clan and member) updates the row.
//   GET  /admin/signups     every sign-up (needs "Authorization: Bearer <ADMIN_KEY>");
//                           ?season=SK7 for one season, ?status=accepted, ?assigned=main|academy,
//                           ?format=csv for a spreadsheet
//   POST /admin/signups/review  { id, status, assignedClan, comment } — the review page
//                           (signup-admin.html) accepts/declines a sign-up and assigns its SK clan
//   POST /admin/signups/delete  { id } — the review page deletes a sign-up for good (the member
//                           can still send the form again)
//
// Settings: wrangler.toml [vars]. Table: migrations/0001_signups.sql + 0002_review.sql.

export const SK_CLANS = { main: 'cCc 276 SK7 Main', academy: 'Academy clan' };
export const GOALS = {
  golden_cyanide: 'Golden cyanide stones',
  sk_title: 'SK title',
  fragments: 'Just fragments for their main account',
  new_main_t9: 'Creation of a new main account (T9)',
  new_main_other: 'Creation of a new main account, other level',
};
export const BUDGETS = {
  not_much: 'Not much',
  gold_pass: 'Only Gold Pass',
  gold_forest: 'Only Gold Pass and Forest Pass',
  all_passes: 'All the passes (Forest, Gold Pass, Elite Pass, ...)',
  passes_hercules: 'All the passes and Hercules',
  whatever_it_takes: 'All the passes, Hercules and whatever else it takes',
};
export const START_WHEN = {
  minute_it_starts: 'The minute it starts',
  day_it_starts: 'The day it starts',
  few_days_later: 'After a few days',
  later_in_season: 'Later in the season',
};

export const STATUSES = { pending: 'Pending', accepted: 'Accepted', declined: 'Declined' };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

function authorized(request, env) {
  if (!env.ADMIN_KEY) return false; // fail closed if the secret isn't set
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return token.length > 0 && timingSafeEqual(token, env.ADMIN_KEY);
}

function clans(env) {
  try {
    const c = JSON.parse(env.CLANS || '{}');
    return c && typeof c === 'object' ? c : {};
  } catch {
    return {};
  }
}

const season = (env) => String(env.SIGNUP_SEASON || '').trim() || 'SK';
const isOpen = (env) => String(env.SIGNUPS_OPEN || '').trim().toLowerCase() !== 'false';
const text = (v, max) => String(v === undefined || v === null ? '' : v).trim().slice(0, max);

function pick(value, allowed, label) {
  const v = text(value, 40);
  if (!Object.prototype.hasOwnProperty.call(allowed, v)) throw new HttpError(400, `Please choose ${label}.`);
  return v;
}

function yesNo(value, label) {
  if (value === true || value === 'yes') return 1;
  if (value === false || value === 'no') return 0;
  throw new HttpError(400, `Please answer: ${label}`);
}

/** A clan's member names, from its Worker. Throws when the list can't be read. */
async function memberNames(workerUrl) {
  const res = await fetch(String(workerUrl).replace(/\/+$/, '') + '/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'getAllMembers' }),
  });
  if (!res.ok) throw new Error(`member list answered ${res.status}`);
  const body = await res.json();
  const list = Array.isArray(body) ? body : (body && Array.isArray(body.data) ? body.data : null);
  if (!list) throw new Error('member list has an unexpected shape');
  return [...new Set(list.map(m => String((m && m.name) || '').trim()).filter(Boolean))];
}

/**
 * The member's name as on their clan's member list, or null when the list
 * doesn't have it. Throws when the list can't be read.
 */
async function findMember(workerUrl, name) {
  const wanted = name.toLowerCase();
  return (await memberNames(workerUrl)).find(n => n.toLowerCase() === wanted) || null;
}

/** Check a submitted form and save it. */
async function submitSignup(env, body, now = new Date()) {
  if (!isOpen(env)) throw new HttpError(403, `Sign-ups for ${season(env)} are closed.`);
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Request body must be a JSON object');
  const clanWorkers = clans(env);
  const homeClan = text(body.clan, 60);
  if (!Object.prototype.hasOwnProperty.call(clanWorkers, homeClan)) throw new HttpError(400, 'Please choose your clan.');
  let memberName = text(body.memberName, 60);
  if (!memberName) throw new HttpError(400, 'Please choose your member name.');

  // The member must be on their clan's list; if that list can't be read right
  // now, the sign-up is kept but marked unverified rather than lost.
  let verified = 0;
  try {
    const found = await findMember(clanWorkers[homeClan], memberName);
    if (!found) throw new HttpError(400, `"${memberName}" is not on the ${homeClan} member list.`);
    memberName = found;
    verified = 1;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    console.error('signup: member list check failed:', e && e.message);
  }

  const participate = yesNo(body.participate, 'do you want to take part?');
  const row = { sk_clan: null, goals: null, target_level: null, played_before: null, budget: null, start_when: null };
  if (participate) {
    row.sk_clan = pick(body.skClan, SK_CLANS, 'the SK clan you want to join');
    const goals = Array.isArray(body.goals) ? [...new Set(body.goals.map(g => text(g, 40)))] : [];
    if (!goals.length) throw new HttpError(400, 'Please choose at least one goal.');
    goals.forEach(g => pick(g, GOALS, 'valid goals'));
    if (goals.includes('new_main_t9') && goals.includes('new_main_other')) {
      throw new HttpError(400, 'Choose either a new T9 main account or a new main account at another level, not both.');
    }
    row.goals = JSON.stringify(goals);
    if (goals.includes('new_main_other')) {
      row.target_level = text(body.targetLevel, 100);
      if (!row.target_level) throw new HttpError(400, 'Please tell us which level you want to reach with the new main account.');
    }
    row.played_before = yesNo(body.playedBefore, 'have you played an SK before?');
    row.budget = pick(body.budget, BUDGETS, 'your budget');
    row.start_when = pick(body.startWhen, START_WHEN, 'when you plan to start');
  }

  const at = now.toISOString();
  const s = season(env);
  const existing = await env.DB.prepare('SELECT id FROM signups WHERE season = ? AND home_clan = ? AND member_name = ?')
    .bind(s, homeClan, memberName).first();
  await env.DB.prepare(`INSERT INTO signups
      (season, home_clan, member_name, member_verified, participate, sk_clan, goals, target_level,
       played_before, budget, start_when, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (season, home_clan, member_name) DO UPDATE SET
        member_verified = excluded.member_verified, participate = excluded.participate,
        sk_clan = excluded.sk_clan, goals = excluded.goals, target_level = excluded.target_level,
        played_before = excluded.played_before, budget = excluded.budget,
        start_when = excluded.start_when, updated_at = excluded.updated_at`)
    .bind(s, homeClan, memberName, verified, participate, row.sk_clan, row.goals, row.target_level,
      row.played_before, row.budget, row.start_when, at, at)
    .run();
  return {
    success: true,
    updated: !!existing,
    signup: { season: s, clan: homeClan, memberName, participate: !!participate, verified: !!verified },
  };
}

/**
 * Every sign-up, newest change first, with readable labels for the stored codes
 * (and the codes themselves under `codes`, for sorting on the review page).
 */
async function listSignups(env, params) {
  const where = [], binds = [];
  if (params.get('season')) { where.push('season = ?'); binds.push(params.get('season')); }
  if (params.get('status')) { where.push('status = ?'); binds.push(params.get('status')); }
  if (params.get('assigned')) { where.push('assigned_clan = ?'); binds.push(params.get('assigned')); }
  const sql = `SELECT * FROM signups${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC`;
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return results.map(r => ({
    id: r.id,
    season: r.season,
    clan: r.home_clan,
    memberName: r.member_name,
    verified: !!r.member_verified,
    participate: !!r.participate,
    skClan: r.sk_clan ? SK_CLANS[r.sk_clan] || r.sk_clan : '',
    goals: (r.goals ? JSON.parse(r.goals) : []).map(g => GOALS[g] || g),
    targetLevel: r.target_level || '',
    playedBefore: r.played_before === null ? '' : r.played_before ? 'Yes' : 'No',
    budget: r.budget ? BUDGETS[r.budget] || r.budget : '',
    startWhen: r.start_when ? START_WHEN[r.start_when] || r.start_when : '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    status: STATUSES[r.status] || r.status,
    assignedClan: r.assigned_clan ? SK_CLANS[r.assigned_clan] || r.assigned_clan : '',
    comment: r.admin_comment || '',
    reviewedAt: r.reviewed_at || '',
    // the member sent the form again after the last review
    changedSinceReview: !!(r.reviewed_at && r.updated_at > r.reviewed_at),
    codes: {
      skClan: r.sk_clan || '', goals: r.goals ? JSON.parse(r.goals) : [], budget: r.budget || '',
      startWhen: r.start_when || '', status: r.status, assignedClan: r.assigned_clan || '',
    },
  }));
}

/** The review page: accept / decline a sign-up, assign its SK clan, add a comment. */
async function reviewSignup(env, body, now = new Date()) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Request body must be a JSON object');
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'id is required');
  const status = pick(body.status, STATUSES, 'a status');
  // Only an accepted sign-up has an SK clan; accepting needs one.
  let assigned = null;
  if (status === 'accepted') assigned = pick(body.assignedClan, SK_CLANS, 'the SK clan to assign');
  const comment = text(body.comment, 2000) || null;
  const at = now.toISOString();
  const res = await env.DB.prepare('UPDATE signups SET status = ?, assigned_clan = ?, admin_comment = ?, reviewed_at = ? WHERE id = ?')
    .bind(status, assigned, comment, at, id).run();
  if (!res.meta || !res.meta.changes) throw new HttpError(404, `No sign-up with id ${id}`);
  return { success: true, id, status: STATUSES[status], assignedClan: assigned ? SK_CLANS[assigned] : '', comment: comment || '', reviewedAt: at };
}

const CSV_COLUMNS = [
  ['Season', 'season'], ['Clan', 'clan'], ['Member', 'memberName'], ['On member list', 'verified'],
  ['Takes part', 'participate'], ['SK clan', 'skClan'], ['Goals', 'goals'], ['Target level', 'targetLevel'],
  ['Played an SK before', 'playedBefore'], ['Budget', 'budget'], ['Starts', 'startWhen'],
  ['First signed up (UTC)', 'createdAt'], ['Last changed (UTC)', 'updatedAt'],
  ['Status', 'status'], ['Assigned SK clan', 'assignedClan'], ['Comment', 'comment'], ['Reviewed (UTC)', 'reviewedAt'],
];

function signupsCsv(rows) {
  const cell = (v) => {
    const t = Array.isArray(v) ? v.join('; ') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v ?? '');
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [CSV_COLUMNS.map(c => c[0]).join(','), ...rows.map(r => CSV_COLUMNS.map(c => cell(r[c[1]])).join(','))].join('\n') + '\n';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname.replace(/\/+$/, '') || '/'}`;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

    try {
      switch (route) {
        case 'GET /health':
          return json(200, { ok: true });
        case 'GET /status':
          return json(200, { success: true, open: isOpen(env), season: season(env) });
        case 'GET /members': {
          const clan = url.searchParams.get('clan') || '';
          const clanWorkers = clans(env);
          if (!Object.prototype.hasOwnProperty.call(clanWorkers, clan)) throw new HttpError(400, 'Unknown clan');
          let names;
          try {
            names = await memberNames(clanWorkers[clan]);
          } catch (e) {
            throw new HttpError(502, `The ${clan} member list could not be loaded (${e.message}).`);
          }
          names.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
          return json(200, { success: true, clan, members: names });
        }
        case 'POST /signup': {
          let body;
          try {
            body = await request.json();
          } catch {
            throw new HttpError(400, 'Request body must be JSON');
          }
          return json(200, await submitSignup(env, body));
        }
        case 'GET /admin/signups': {
          if (!authorized(request, env)) return json(401, { success: false, error: 'Unauthorized' });
          const signups = await listSignups(env, url.searchParams);
          if (url.searchParams.get('format') === 'csv') {
            return new Response(signupsCsv(signups), {
              status: 200,
              headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="sk-signups.csv"' },
            });
          }
          return json(200, { success: true, count: signups.length, signups });
        }
        case 'POST /admin/signups/review': {
          if (!authorized(request, env)) return json(401, { success: false, error: 'Unauthorized' });
          let body;
          try {
            body = await request.json();
          } catch {
            throw new HttpError(400, 'Request body must be JSON');
          }
          return json(200, await reviewSignup(env, body));
        }
        case 'POST /admin/signups/delete': {
          if (!authorized(request, env)) return json(401, { success: false, error: 'Unauthorized' });
          let body;
          try {
            body = await request.json();
          } catch {
            throw new HttpError(400, 'Request body must be JSON');
          }
          const id = Number(body && body.id);
          if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'id is required');
          const res = await env.DB.prepare('DELETE FROM signups WHERE id = ?').bind(id).run();
          if (!res.meta || !res.meta.changes) throw new HttpError(404, `No sign-up with id ${id}`);
          return json(200, { success: true, id });
        }
        default:
          return json(404, { success: false, error: `No route for ${route}` });
      }
    } catch (e) {
      return json(e instanceof HttpError ? e.status : 500, { success: false, error: e.message });
    }
  },
};
