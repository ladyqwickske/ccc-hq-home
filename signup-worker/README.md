# ccc-hq-signups — the SK sign-up form's database

The form at **ccc-hq.com/signup.html** sends its answers here. This is a small
Cloudflare Worker with its own D1 database, at `https://hq-db.ccc-hq.com`. It is
separate from the clans' database Workers. It only *reads* each clan's member
list (from that clan's Worker) to check that the member really is in the clan
they picked.

## First-time setup

```powershell
cd signup-worker
npm install
npx wrangler login
npx wrangler d1 create ccc-hq-signups     # copy the database_id it prints into wrangler.toml
npm run migrate                           # creates the signups table
npx wrangler secret put ADMIN_KEY         # any long random string; needed to read the sign-ups
npm run deploy                            # → https://hq-db.ccc-hq.com
```

Check it: `https://hq-db.ccc-hq.com/status` should show `{"success":true,"open":true,"season":"SK7"}`.

## Settings (`wrangler.toml` → `[vars]`, then `npm run deploy`)

- `SIGNUPS_OPEN = "false"` once SK7 has started: the form then says sign-ups are closed.
- `SIGNUP_SEASON`: the SK the sign-ups are for. Set it to e.g. `"SK8"` for a new
  round; earlier rounds stay in the database.
- `CLANS`: the clans in the first list on the form, and their Workers.
  When you add a clan here, add it to `CLANS` in `signup.html` too.

## Reading the sign-ups

Download them as a spreadsheet (CSV):

```powershell
curl -H "Authorization: Bearer <ADMIN_KEY>" "https://hq-db.ccc-hq.com/admin/signups?format=csv&season=SK7" -o sk7-signups.csv
```

Leave out `format=csv` to get JSON. Or run SQL directly on the database:

```powershell
npx wrangler d1 execute ccc-hq-signups --remote --command "SELECT home_clan, member_name, sk_clan, budget, start_when FROM signups WHERE season = 'SK7' AND participate = 1 ORDER BY sk_clan, home_clan"
npx wrangler d1 execute ccc-hq-signups --remote --command "SELECT sk_clan, budget, COUNT(*) AS members FROM signups WHERE season = 'SK7' AND participate = 1 GROUP BY sk_clan, budget"
```

Stored codes, column by column (the CSV and JSON show the full labels instead):

| Column | Codes |
|---|---|
| `participate`, `played_before`, `member_verified` | `1` yes, `0` no |
| `sk_clan` | `main` (cCc 276 SK7 Main), `academy` (Academy clan) |
| `goals` (a list) | `golden_cyanide`, `sk_title`, `fragments`, `new_main_t9`, `new_main_other` (+ `target_level`) |
| `budget` | `not_much`, `gold_pass`, `gold_forest`, `all_passes`, `passes_hercules`, `whatever_it_takes` |
| `start_when` | `minute_it_starts`, `day_it_starts`, `few_days_later`, `later_in_season` |

One row per member per season. A member who sends the form again updates their
row, so the latest answers count. `member_verified = 0` means their clan's
member list couldn't be reached when they signed up. The sign-up was kept, but
the name wasn't checked.

## Tests

```powershell
npm run migrate:local
npx wrangler dev --local --port 8787 --var ADMIN_KEY:local-test-key --var "CLANS:{\"cCc Legends\":\"http://127.0.0.1:8791\",\"cCc Champions\":\"http://127.0.0.1:8791/down\"}"
node test/signups.mjs http://127.0.0.1:8787 local-test-key     # in a second window
```
