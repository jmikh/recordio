-- Remove expiration from workspace invitations.
-- Invitations now persist indefinitely; admins rescind them manually.

ALTER TABLE public.workspace_invitations
    ALTER COLUMN expires_at DROP NOT NULL,
    ALTER COLUMN expires_at DROP DEFAULT,
    ALTER COLUMN expires_at SET DEFAULT NULL;

-- Null out any existing future expiry dates so old invites don't appear expired
UPDATE public.workspace_invitations
SET expires_at = NULL
WHERE status = 'pending';

-- Drop 'expired' from the status check constraint and re-add without it
ALTER TABLE public.workspace_invitations
    DROP CONSTRAINT IF EXISTS workspace_invitations_status_check;

ALTER TABLE public.workspace_invitations
    ADD CONSTRAINT workspace_invitations_status_check
    CHECK (status IN ('pending', 'accepted', 'declined'));
