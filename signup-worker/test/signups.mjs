// The sign-up Worker (src/index.js), against a local copy whose clans point at a fake
// member list (this script starts it on port 8791):
//   npm run migrate:local
//   npx wrangler dev --local --port 8787 --var ADMIN_KEY:local-test-key \
//     --var 'CLANS:{"cCc Legends":"http://127.0.0.1:8791","cCc Champions":"http://127.0.0.1:8791/down"}'
//   node test/signups.mjs http://127.0.0.1:8787 local-test-key
import http from 'node:http';

const [base, key] = process.argv.slice(2);
if (!base || !key) {
  console.log('usage: node test/signups.mjs <worker URL> <ADMIN_KEY>');
  process.exit(1);
}
let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!cond) failures++;
};

// Fake clan Worker: "/" answers the member list (wrapped, as the live Workers do), "/down" fails.
const fake = http.createServer((req, res) => {
  if (req.url.startsWith('/down')) { res.writeHead(503); res.end('down'); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, data: [{ name: 'Andalusy' }, { name: 'ANGEL' }] }));
});
await new Promise(r => fake.listen(8791, '127.0.0.1', r));

const post = async (body) => {
  const res = await fetch(base + '/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, cors: res.headers.get('Access-Control-Allow-Origin'), body: await res.json() };
};
const full = {
  clan: 'cCc Legends', memberName: 'andalusy', participate: 'yes', skClan: 'main',
  goals: ['golden_cyanide', 'sk_title'], playedBefore: 'no', budget: 'gold_forest', startWhen: 'day_it_starts',
};

try {
  const status = await (await fetch(base + '/status')).json();
  check('status says open, with the season', status.open === true && status.season === 'SK7', JSON.stringify(status));

  let m = await (await fetch(base + '/members?clan=' + encodeURIComponent('cCc Legends'))).json();
  check('the form gets a clan\'s member names, sorted', m.success && m.members.join(',') === 'Andalusy,ANGEL', JSON.stringify(m));
  let mres = await fetch(base + '/members?clan=Nope');
  check('an unknown clan has no member list', mres.status === 400);
  mres = await fetch(base + '/members?clan=' + encodeURIComponent('cCc Champions'));
  check('an unreachable member list is reported', mres.status === 502 && /could not be loaded/.test((await mres.json()).error));

  let r = await post(full);
  check('a full sign-up is saved', r.status === 200 && r.body.success && !r.body.updated, JSON.stringify(r.body));
  check('the answer is readable by the site (CORS)', r.cors === '*');
  check('the name is stored as on the member list', r.body.signup && r.body.signup.memberName === 'Andalusy' && r.body.signup.verified);

  r = await post({ ...full, budget: 'whatever_it_takes' });
  check('signing up again updates the same row', r.status === 200 && r.body.updated === true);

  r = await post({ clan: 'cCc Legends', memberName: 'ANGEL', participate: 'no' });
  check('"not taking part" needs no other answers', r.status === 200 && r.body.success);

  r = await post({ ...full, memberName: 'Nobody' });
  check('a name not on the clan list is refused', r.status === 400 && /not on the cCc Legends member list/.test(r.body.error));
  r = await post({ ...full, clan: 'cCc Somewhere' });
  check('an unknown clan is refused', r.status === 400);
  r = await post({ ...full, budget: 'lots' });
  check('an unknown budget is refused', r.status === 400 && /budget/.test(r.body.error));
  r = await post({ ...full, goals: [] });
  check('at least one goal is needed', r.status === 400);
  r = await post({ ...full, goals: ['new_main_other'] });
  check('"other level" needs the level', r.status === 400 && /level/.test(r.body.error));
  r = await post({ ...full, goals: ['new_main_t9', 'new_main_other'], targetLevel: 'G7' });
  check('both new-main goals together are refused', r.status === 400);
  r = await post({ ...full, memberName: 'ANGEL', goals: ['new_main_other'], targetLevel: 'G7 / T7' });
  check('"other level" with the level is saved', r.status === 200 && r.body.success);

  r = await post({ ...full, clan: 'cCc Champions', memberName: 'Someone' });
  check('an unreachable member list keeps the sign-up, unverified', r.status === 200 && r.body.signup && r.body.signup.verified === false);

  let res = await fetch(base + '/admin/signups');
  check('the list needs the admin key', res.status === 401);
  res = await fetch(base + '/admin/signups', { headers: { Authorization: 'Bearer wrong' } });
  check('a wrong key is refused', res.status === 401);
  res = await fetch(base + '/admin/signups', { headers: { Authorization: `Bearer ${key}` } });
  const list = await res.json();
  check('the list has one row per member', list.success && list.count === 3, JSON.stringify(list).slice(0, 300));
  const a = (list.signups || []).find(s => s.memberName === 'Andalusy');
  check('stored answers come back as labels', a && a.budget.startsWith('All the passes, Hercules') && a.skClan === 'cCc 276 SK7 Main'
    && a.goals.join('|') === 'Golden cyanide stones|SK title' && a.playedBefore === 'No' && a.startWhen === 'The day it starts');
  const angel = (list.signups || []).find(s => s.memberName === 'ANGEL');
  check('the last answer wins (ANGEL now takes part)', angel && angel.participate && angel.targetLevel === 'G7 / T7');

  check('new sign-ups are pending', a && a.status === 'Pending' && a.assignedClan === '' && a.codes.budget === 'whatever_it_takes');

  const review = async (body, auth = key) => {
    const res = await fetch(base + '/admin/signups/review', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` }, body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  let v = await review({ id: a.id, status: 'accepted', assignedClan: 'academy', comment: 'Good fit for Academy' }, 'wrong');
  check('a review needs the admin key', v.status === 401);
  v = await review({ id: a.id, status: 'accepted' });
  check('accepting needs an SK clan', v.status === 400 && /SK clan/.test(v.body.error));
  v = await review({ id: a.id, status: 'maybe' });
  check('an unknown status is refused', v.status === 400);
  v = await review({ id: 999999, status: 'pending' });
  check('an unknown id is refused', v.status === 404);
  v = await review({ id: a.id, status: 'accepted', assignedClan: 'academy', comment: 'Good fit for Academy' });
  check('a sign-up is accepted into a clan', v.status === 200 && v.body.status === 'Accepted' && v.body.assignedClan === 'Academy clan');
  v = await review({ id: angel.id, status: 'declined', assignedClan: 'main', comment: '' });
  check('declining drops the SK clan', v.status === 200 && v.body.assignedClan === '');

  r = await post({ ...full, startWhen: 'later_in_season' });
  res = await fetch(base + '/admin/signups?status=accepted&assigned=academy', { headers: { Authorization: `Bearer ${key}` } });
  const accepted = await res.json();
  const a2 = accepted.signups && accepted.signups[0];
  check('the accepted list per clan', accepted.count === 1 && a2.memberName === 'Andalusy');
  check('sending the form again keeps the review', a2 && a2.status === 'Accepted' && a2.comment === 'Good fit for Academy' && a2.startWhen === 'Later in the season');
  check('…and flags the change since the review', a2 && a2.changedSinceReview === true);

  res = await fetch(base + '/admin/signups?format=csv', { headers: { Authorization: `Bearer ${key}` } });
  const csv = await res.text();
  check('CSV export', res.headers.get('Content-Type').startsWith('text/csv') && csv.split('\n')[0].startsWith('Season,Clan,Member') && csv.split('\n')[0].includes('Assigned SK clan') && csv.trim().split('\n').length === 4);
} finally {
  fake.close();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
