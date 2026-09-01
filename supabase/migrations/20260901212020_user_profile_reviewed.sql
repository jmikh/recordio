-- Leave-review modal: whether/when the user marked themselves as having
-- left a Chrome Web Store review (self-reported — "Leave a review" and
-- "I already left a review" both set it). NULL = never claimed; the
-- webapp stops asking once set. Written by /user-review-set.
ALTER TABLE public.user_profiles
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
