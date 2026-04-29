


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."cleanup_stale_uploads"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    -- Move stale uploading videos to the deletion queue
    INSERT INTO deleted_videos (cf_video_uid, source)
    SELECT cf_video_uid, 'stale_upload'
    FROM shared_videos
    WHERE status = 'uploading'
      AND upload_started_at < NOW() - interval '1 hour';

    -- Remove them from shared_videos
    DELETE FROM shared_videos
    WHERE status = 'uploading'
      AND upload_started_at < NOW() - interval '1 hour';

    RAISE LOG '[StaleUploadCleanup] Cleaned up stale uploads';
END;
$$;


ALTER FUNCTION "public"."cleanup_stale_uploads"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_trials"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $_$
declare
    r record;
    mp_token text := '773bc18d036f7f77ec70ec94e7eec508';
begin
    -- Find all trialing subscriptions past their period end
    for r in
        select s.user_id, s.current_period_end
        from public.subscriptions s
        where s.status = 'trialing'
          and s.current_period_end < now()
    loop
        -- Update DB
        update public.subscriptions
        set status = 'expired', updated_at = now()
        where user_id = r.user_id;

        -- Update Mixpanel profile
        perform net.http_post(
            url := 'https://api.mixpanel.com/engage#profile-set',
            body := jsonb_build_array(jsonb_build_object(
                '$token', mp_token,
                '$distinct_id', r.user_id,
                '$set', jsonb_build_object(
                    'current_plan_type', 'basic',
                    'last_active_plan_type', 'pro_trial',
                    'last_active_plan_end_date', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
                )
            )),
            headers := '{"Content-Type": "application/json", "Accept": "text/plain"}'::jsonb
        );

        raise log '[TrialExpiry] Expired trial for user: %', r.user_id;
    end loop;
end;
$_$;


ALTER FUNCTION "public"."expire_trials"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
    -- Create trialing subscription (7-day free trial)
    insert into public.subscriptions (user_id, status, current_period_end, cancel_at_period_end, updated_at)
    values (new.id, 'trialing', now() + interval '7 days', true, now());

    return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rollback_transcription_usage"("p_user_id" "uuid", "p_minutes" numeric) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
    UPDATE transcription_usage
    SET minutes_used = GREATEST(minutes_used - p_minutes, 0)
    WHERE user_id = p_user_id;
END;
$$;


ALTER FUNCTION "public"."rollback_transcription_usage"("p_user_id" "uuid", "p_minutes" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."upsert_transcription_usage"("p_user_id" "uuid", "p_minutes" numeric, "p_reset_date" timestamp with time zone, "p_limit" numeric) RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
    v_current_minutes NUMERIC;
    v_current_reset   TIMESTAMPTZ;
    v_new_minutes     NUMERIC;
BEGIN
    -- Try to get existing row with a row lock
    SELECT minutes_used, reset_date
    INTO v_current_minutes, v_current_reset
    FROM transcription_usage
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        -- First usage ever: insert new row
        INSERT INTO transcription_usage (user_id, minutes_used, reset_date)
        VALUES (p_user_id, p_minutes, p_reset_date);
        RETURN p_minutes;
    END IF;

    -- Check if cycle has rolled over (reset_date is earlier than new cycle date)
    IF v_current_reset < p_reset_date THEN
        -- New cycle: reset usage
        v_new_minutes := p_minutes;
    ELSE
        -- Same cycle: check limit
        v_new_minutes := v_current_minutes + p_minutes;
        IF v_new_minutes > p_limit THEN
            RAISE EXCEPTION 'rate_limit_exceeded';
        END IF;
    END IF;

    UPDATE transcription_usage
    SET minutes_used = v_new_minutes,
        reset_date = p_reset_date
    WHERE user_id = p_user_id;

    RETURN v_new_minutes;
END;
$$;


ALTER FUNCTION "public"."upsert_transcription_usage"("p_user_id" "uuid", "p_minutes" numeric, "p_reset_date" timestamp with time zone, "p_limit" numeric) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."deleted_videos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cf_video_uid" "text" NOT NULL,
    "source" "text" NOT NULL,
    "deleted_at" timestamp with time zone DEFAULT "now"(),
    "attempts" integer DEFAULT 0
);


ALTER TABLE "public"."deleted_videos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_unsubscribes" (
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."email_unsubscribes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shared_videos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "project_id" "text" NOT NULL,
    "project_name" "text" NOT NULL,
    "cf_video_uid" "text" NOT NULL,
    "version" integer DEFAULT 1,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "description" "text" DEFAULT ''::"text",
    "creator_name" "text",
    "status" "text" DEFAULT 'ready'::"text",
    "upload_started_at" timestamp with time zone
);


ALTER TABLE "public"."shared_videos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "status" "text" DEFAULT 'inactive'::"text" NOT NULL,
    "plan_id" "text",
    "current_period_start" timestamp with time zone,
    "current_period_end" timestamp with time zone,
    "cancel_at_period_end" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "billing_interval" "text"
);


ALTER TABLE "public"."subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transcription_usage" (
    "user_id" "uuid" NOT NULL,
    "minutes_used" numeric(8,3) DEFAULT 0 NOT NULL,
    "reset_date" timestamp with time zone NOT NULL
);


ALTER TABLE "public"."transcription_usage" OWNER TO "postgres";


ALTER TABLE ONLY "public"."deleted_videos"
    ADD CONSTRAINT "deleted_videos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_unsubscribes"
    ADD CONSTRAINT "email_unsubscribes_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."shared_videos"
    ADD CONSTRAINT "shared_videos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shared_videos"
    ADD CONSTRAINT "shared_videos_user_id_project_id_key" UNIQUE ("user_id", "project_id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_stripe_customer_id_key" UNIQUE ("stripe_customer_id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_stripe_subscription_id_key" UNIQUE ("stripe_subscription_id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."transcription_usage"
    ADD CONSTRAINT "transcription_usage_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."email_unsubscribes"
    ADD CONSTRAINT "email_unsubscribes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shared_videos"
    ADD CONSTRAINT "shared_videos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transcription_usage"
    ADD CONSTRAINT "transcription_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Public can view shared video metadata" ON "public"."shared_videos" FOR SELECT USING (true);



CREATE POLICY "Users can delete own shared videos" ON "public"."shared_videos" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own shared videos" ON "public"."shared_videos" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can manage own unsubscribe" ON "public"."email_unsubscribes" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own shared videos" ON "public"."shared_videos" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own shared videos" ON "public"."shared_videos" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own subscription" ON "public"."subscriptions" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."deleted_videos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_unsubscribes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shared_videos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

















































































































































































GRANT ALL ON FUNCTION "public"."cleanup_stale_uploads"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_stale_uploads"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_stale_uploads"() TO "service_role";



GRANT ALL ON FUNCTION "public"."expire_trials"() TO "anon";
GRANT ALL ON FUNCTION "public"."expire_trials"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."expire_trials"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rollback_transcription_usage"("p_user_id" "uuid", "p_minutes" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."rollback_transcription_usage"("p_user_id" "uuid", "p_minutes" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rollback_transcription_usage"("p_user_id" "uuid", "p_minutes" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."upsert_transcription_usage"("p_user_id" "uuid", "p_minutes" numeric, "p_reset_date" timestamp with time zone, "p_limit" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."upsert_transcription_usage"("p_user_id" "uuid", "p_minutes" numeric, "p_reset_date" timestamp with time zone, "p_limit" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."upsert_transcription_usage"("p_user_id" "uuid", "p_minutes" numeric, "p_reset_date" timestamp with time zone, "p_limit" numeric) TO "service_role";
























GRANT ALL ON TABLE "public"."deleted_videos" TO "anon";
GRANT ALL ON TABLE "public"."deleted_videos" TO "authenticated";
GRANT ALL ON TABLE "public"."deleted_videos" TO "service_role";



GRANT ALL ON TABLE "public"."email_unsubscribes" TO "anon";
GRANT ALL ON TABLE "public"."email_unsubscribes" TO "authenticated";
GRANT ALL ON TABLE "public"."email_unsubscribes" TO "service_role";



GRANT ALL ON TABLE "public"."shared_videos" TO "anon";
GRANT ALL ON TABLE "public"."shared_videos" TO "authenticated";
GRANT ALL ON TABLE "public"."shared_videos" TO "service_role";



GRANT ALL ON TABLE "public"."subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."transcription_usage" TO "anon";
GRANT ALL ON TABLE "public"."transcription_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."transcription_usage" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";

create extension if not exists "pg_net" with schema "public";

CREATE TRIGGER "on-user-created-mixpanel" AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request('https://rzbyqcdtjuclioingiaf.supabase.co/functions/v1/on-user-created-mixpanel', 'POST', '{"Content-type":"application/json"}', '{}', '5000');

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER "send-welcome-email" AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request('https://rzbyqcdtjuclioingiaf.supabase.co/functions/v1/send-welcome-email', 'POST', '{"Content-type":"application/json"}', '{}', '5000');

CREATE TRIGGER protect_buckets_delete BEFORE DELETE ON storage.buckets FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();

CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


