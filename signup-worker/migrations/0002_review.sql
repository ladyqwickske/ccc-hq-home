-- Reviewing sign-ups (signup-admin.html → POST /admin/signups/review): whether a
-- sign-up is accepted, which SK clan it is assigned to, and the admins' comment.
-- A member who sends the form again keeps their review (only their answers change).
ALTER TABLE signups ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';  -- 'pending' | 'accepted' | 'declined'
ALTER TABLE signups ADD COLUMN assigned_clan TEXT;                      -- 'main' | 'academy' (accepted only)
ALTER TABLE signups ADD COLUMN admin_comment TEXT;
ALTER TABLE signups ADD COLUMN reviewed_at TEXT;                        -- last review change
