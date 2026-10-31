-- Made by `npm run db:snapshot` from the migrations. Don't edit it: write a migration, then run the script.
-- Read it to see a function or table as it is now, without hunting for its newest migration.

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


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."admin_announcements"() RETURNS TABLE("id" "uuid", "name" "text", "is_on" boolean, "starts_at" timestamp with time zone, "ends_at" timestamp with time zone, "show_modal" boolean, "modal_text" "text", "modal_attachment" "jsonb", "modal_close_after" integer, "show_bar" boolean, "bar_html" "text", "bar_close_after" integer, "repeat" "text", "pages" "text"[], "genders" "text"[], "age_min" integer, "age_max" integer, "provinces" "text"[], "town_words" "text"[], "education_levels" "text"[], "field_words" "text"[], "presentations_min" integer, "presentations_max" integer, "roles" "text"[], "created_by" "uuid", "created_at" timestamp with time zone, "updated_at" timestamp with time zone, "modal_size" "text", "status" "text", "matched" integer, "closed_modal" integer, "closed_bar" integer, "counted_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;

  return query
  select
    a.id, a.name, a.is_on, a.starts_at, a.ends_at,
    a.show_modal, a.modal_text, a.modal_attachment, a.modal_close_after, a.show_bar, a.bar_html, a.bar_close_after,
    a.repeat, a.pages, a.genders, a.age_min, a.age_max, a.provinces, a.town_words,
    a.education_levels, a.field_words, a.presentations_min, a.presentations_max, a.roles,
    a.created_by, a.created_at, a.updated_at, a.modal_size,
    case
      when a.ends_at is not null and a.ends_at <= now() then 'ended'
      when not a.is_on then 'off'
      when a.starts_at is not null and a.starts_at > now() then 'scheduled'
      else 'live'
    end,
    a.matched_count, a.closed_modal_count, a.closed_bar_count, a.counted_at
  from public.announcements a
  order by a.created_at desc, a.id;
end;
$$;


ALTER FUNCTION "public"."admin_announcements"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_cancel_review"("target_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can cancel reviews.' using errcode = '42501';
  end if;
  perform public.cancel_review(target_id, true);
end;
$$;


ALTER FUNCTION "public"."admin_cancel_review"("target_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_editors"() RETURNS TABLE("user_id" "uuid", "email" "text", "added_at" timestamp with time zone, "presentations" integer, "photos" integer, "published_reviews" integer, "last_review" "date")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select
    e.user_id,
    coalesce(u.email, ''),
    e.added_at,
    (select count(*)::int from public.presentations p where p.owner_id = e.user_id and p.shared_from is null),
    (select count(*)::int from public.photos ph where ph.user_id = e.user_id),
    (select count(*)::int from public.presentation_reviewers r where r.reviewer_id = e.user_id),
    (select max(r.reviewed_on) from public.presentation_reviewers r where r.reviewer_id = e.user_id)
  from public.editors e
  join auth.users u on u.id = e.user_id
  where public.is_admin();
$$;


ALTER FUNCTION "public"."admin_editors"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_log_name"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select coalesce(nullif(trim(st.display_name), ''), split_part(u.email, '@', 1), '')
  from auth.users u
  left join public.user_settings st on st.user_id = u.id
  where u.id = (select auth.uid());
$$;


ALTER FUNCTION "public"."admin_log_name"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_may_delete"("target_id" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select public.is_admin() and exists (
    select 1 from public.presentations p
    where (p.id = target_id or p.shared_from = target_id)
      and (
        p.hidden_at is not null
        or exists (select 1 from public.presentation_reports r where r.presentation_id = p.id)
      )
  );
$$;


ALTER FUNCTION "public"."admin_may_delete"("target_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_overview"("days" integer) RETURNS TABLE("series" "text", "day" "date", "total" integer)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  since timestamptz := ((now() at time zone 'utc')::date - (days - 1)) at time zone 'utc';
begin
  if not public.is_admin() then
    raise exception 'Only admins can see the overview.' using errcode = '42501';
  end if;
  if days not in (7, 30, 90) then
    raise exception 'days must be 7, 30 or 90.' using errcode = '22023';
  end if;

  return query
  select s.series, s.day, count(*)::int
  from (
    select case when p.shared_from is null then 'presentations' else 'publishes' end as series,
           (p.created_at at time zone 'utc')::date as day
      from public.presentations p where p.created_at >= since
    union all
    select case e.kind when 'like' then 'likes' when 'save' then 'saves' else 'reports' end,
           (e.created_at at time zone 'utc')::date
      from public.activity_events e where e.created_at >= since
    union all
    select 'submissions', (x.submitted_at at time zone 'utc')::date
      from public.presentation_submissions x where x.submitted_at >= since
    union all
    select 'reviews', (r.first_submitted_at at time zone 'utc')::date
      from public.presentation_reviews r where r.first_submitted_at >= since
    union all
    select 'signups', (u.created_at at time zone 'utc')::date
      from auth.users u where public.is_super_admin() and u.created_at >= since
    union all
    select 'logins', (u.last_sign_in_at at time zone 'utc')::date
      from auth.users u where public.is_super_admin() and u.last_sign_in_at >= since
    union all
    select case h.kind when 'pause' then 'pauses' else 'bans' end,
           (h.created_at at time zone 'utc')::date
      from public.click_history h
      where public.is_super_admin() and h.kind in ('pause', 'ban') and h.created_at >= since
  ) s
  group by s.series, s.day;
end;
$$;


ALTER FUNCTION "public"."admin_overview"("days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_remove_profile_photo"("target" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  had_photo boolean;
begin
  if not public.is_admin() then
    raise exception 'Only admins can remove a profile photo.' using errcode = '42501';
  end if;
  update public.profile_photos p set src = '', updated_at = now()
  where p.user_id = target and p.src <> ''
  returning true into had_photo;
  if had_photo then
    perform public.log_admin_action(
      'profile_photo_removed', 'user', target::text,
      (
        select coalesce(nullif(trim(s.display_name), ''), split_part(u.email, '@', 1), '')
        from auth.users u
        left join public.user_settings s on s.user_id = u.id
        where u.id = target
      ),
      null
    );
  end if;
end;
$$;


ALTER FUNCTION "public"."admin_remove_profile_photo"("target" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_reviewers"() RETURNS TABLE("presentation_id" "text", "name" "text", "email" "text", "reviewed_on" "date", "approved_at" timestamp with time zone, "approver_name" "text", "approver_email" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select
    r.presentation_id,
    r.name,
    r.email,
    r.reviewed_on,
    r.approved_at,
    coalesce(s.display_name, ''),
    coalesce(u.email, '')
  from public.presentation_reviewers r
  left join public.user_settings s on s.user_id = r.approved_by
  left join auth.users u on u.id = r.approved_by
  where public.is_admin()
  order by r.reviewed_on desc, r.approved_at desc nulls last;
$$;


ALTER FUNCTION "public"."admin_reviewers"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_reviews"() RETURNS TABLE("presentation_id" "text", "title" "text", "reviewer_name" "text", "status" "text", "started_at" timestamp with time zone, "submitted_at" timestamp with time zone, "ended_at" timestamp with time zone, "is_author_update" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select
    r.presentation_id,
    p.title,
    coalesce(nullif(s.display_name, '') || coalesce(' (' || u.email || ')', ''), u.email, 'Deleted account'),
    r.status,
    r.started_at,
    r.submitted_at,
    r.ended_at,
    r.is_author_update
  from public.presentation_reviews r
  join public.presentations p on p.id = r.presentation_id
  left join public.user_settings s on s.user_id = r.reviewer_id
  left join auth.users u on u.id = r.reviewer_id
  where public.is_admin() and r.status in ('reviewing', 'submitted', 'canceled')
  order by coalesce(r.submitted_at, r.ended_at, r.started_at) desc;
$$;


ALTER FUNCTION "public"."admin_reviews"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_submissions"() RETURNS TABLE("presentation_id" "text", "title" "text", "editor_name" "text", "editor_email" "text", "submitted_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select
    s.presentation_id,
    p.title,
    coalesce(nullif(trim(st.display_name), ''), split_part(u.email, '@', 1)),
    u.email,
    s.submitted_at
  from public.presentation_submissions s
  join public.presentations p on p.id = s.presentation_id
  join auth.users u on u.id = s.submitter_id
  left join public.user_settings st on st.user_id = s.submitter_id
  where public.is_admin() and s.status = 'submitted'
  order by s.submitted_at;
$$;


ALTER FUNCTION "public"."admin_submissions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_teacher_breakdown"() RETURNS TABLE("kind" "text", "label" "text", "total" bigint)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not public.is_admin() then
    raise exception 'Admins only.' using errcode = '42501';
  end if;
  return query
    select 'province', s.province, count(*) from public.user_settings s group by s.province
    union all
    select 'age', a.label, count(*)
    from public.user_settings s
    cross join lateral (
      select case
        when s.birth_date is null then ''
        when public.age_on(s.birth_date, public.manila_today()) < 25 then '18–24'
        when public.age_on(s.birth_date, public.manila_today()) < 35 then '25–34'
        when public.age_on(s.birth_date, public.manila_today()) < 45 then '35–44'
        when public.age_on(s.birth_date, public.manila_today()) < 55 then '45–54'
        else '55+'
      end as label
    ) a
    group by a.label
    union all
    select 'gender', s.gender, count(*) from public.user_settings s group by s.gender;
end;
$$;


ALTER FUNCTION "public"."admin_teacher_breakdown"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_todo_counts"() RETURNS TABLE("reviews" integer, "submissions" integer, "reports" integer)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can see this.' using errcode = '42501';
  end if;

  return query
  select
    (select count(*)::int from public.presentation_reviews where status = 'submitted'),
    (select count(*)::int from public.presentation_submissions where status = 'submitted'),
    (select count(distinct presentation_id)::int from public.presentation_reports);
end;
$$;


ALTER FUNCTION "public"."admin_todo_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_used_photo_srcs"() RETURNS "text"[]
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can see this.' using errcode = '42501';
  end if;
  return public.used_photo_srcs();
end;
$$;


ALTER FUNCTION "public"."admin_used_photo_srcs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."age_on"("birth" "date", "today" "date") RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select extract(year from today)::int - extract(year from birth)::int
    - case when (extract(month from today), extract(day from today)) < (extract(month from birth), extract(day from birth))
        then 1 else 0 end;
$$;


ALTER FUNCTION "public"."age_on"("birth" "date", "today" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."announce_maintenance"("planned" timestamp with time zone, "note" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;
  if (select m.is_on from public.maintenance m where m.id) then
    raise exception 'Maintenance is already on.' using errcode = '22023';
  end if;
  if planned is not null and planned <= now() then
    raise exception 'Pick a time in the future.' using errcode = '22023';
  end if;

  update public.maintenance
  set planned_at = planned, message = case when planned is null then message else btrim(coalesce(note, '')) end
  where id;

  if planned is not null then
    perform public.log_admin_action(
      'maintenance_announced', 'site', null, 'QuizMatter', jsonb_build_object('planned_at', planned)
    );
  end if;
end;
$$;


ALTER FUNCTION "public"."announce_maintenance"("planned" timestamp with time zone, "note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."announcement_attachment_from_html"("html" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
declare
  tag text;
  src text;
  width int;
  height int;
begin
  for tag in select m[1] from regexp_matches(coalesce(html, ''), '(<img[^>]*>)', 'gi') as m loop
    src := substring(tag from 'src="([^"]+)"');
    if starts_with(src, 'https://images.quizmatter.com/uploads/') and char_length(src) <= 300 then
      width := substring(tag from 'width="([0-9]{1,4})"')::int;
      height := substring(tag from 'height="([0-9]{1,4})"')::int;
      return jsonb_strip_nulls(jsonb_build_object(
        'kind', 'photo', 'src', src,
        'width', case when width between 1 and 1920 then width end,
        'height', case when height between 1 and 1920 then height end
      ));
    end if;
  end loop;
  return null;
end;
$$;


ALTER FUNCTION "public"."announcement_attachment_from_html"("html" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."announcement_attachment_ok"("a" "jsonb") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $_$
  select a is null or coalesce(
    jsonb_typeof(a) = 'object'
    and case a ->> 'kind'
      when 'facebook' then
        (select array_agg(k) from jsonb_object_keys(a) k) <@ array['kind', 'href', 'video']
        and jsonb_typeof(a -> 'href') = 'string'
        and char_length(a ->> 'href') <= 500
        and a ->> 'href' ~ '^https://(((www|m|web)\.)?facebook\.com|fb\.watch)/[^\s"''<>]+$'
        and jsonb_typeof(a -> 'video') = 'boolean'
      when 'photo' then
        (select array_agg(k) from jsonb_object_keys(a) k) <@ array['kind', 'src', 'width', 'height']
        and public.announcement_picture_ok(a)
      when 'youtube' then
        (select array_agg(k) from jsonb_object_keys(a) k) <@ array['kind', 'video_id', 'title', 'src', 'width', 'height']
        and public.announcement_picture_ok(a)
        and jsonb_typeof(a -> 'video_id') = 'string' and a ->> 'video_id' ~ '^[A-Za-z0-9_-]{11}$'
        and jsonb_typeof(a -> 'title') = 'string' and char_length(a ->> 'title') <= 200
      else false
    end,
    false
  );
$_$;


ALTER FUNCTION "public"."announcement_attachment_ok"("a" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."announcement_audience"("a" "jsonb") RETURNS integer
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;
  return public.announcement_count(jsonb_populate_record(null::public.announcements, a));
end;
$$;


ALTER FUNCTION "public"."announcement_audience"("a" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."announcement_provinces_ok"("names" "text"[]) RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select not exists (select 1 from unnest(names) n where n is null or not public.is_province(n));
$$;


ALTER FUNCTION "public"."announcement_provinces_ok"("names" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."announcement_words_ok"("words" "text"[]) RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select coalesce(cardinality(words), 0) <= 20
    and not exists (select 1 from unnest(words) w where w is null or btrim(w) = '' or char_length(w) > 60);
$$;


ALTER FUNCTION "public"."announcement_words_ok"("words" "text"[]) OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."announcements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "is_on" boolean DEFAULT false NOT NULL,
    "starts_at" timestamp with time zone,
    "ends_at" timestamp with time zone,
    "show_modal" boolean DEFAULT false NOT NULL,
    "modal_close_after" integer DEFAULT 0 NOT NULL,
    "show_bar" boolean DEFAULT false NOT NULL,
    "bar_html" "text" DEFAULT ''::"text" NOT NULL,
    "bar_close_after" integer DEFAULT 0 NOT NULL,
    "repeat" "text" DEFAULT 'once'::"text" NOT NULL,
    "pages" "text"[] DEFAULT '{all}'::"text"[] NOT NULL,
    "genders" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "age_min" integer,
    "age_max" integer,
    "provinces" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "town_words" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "education_levels" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "field_words" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "presentations_min" integer,
    "presentations_max" integer,
    "roles" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "modal_size" "text" DEFAULT 'large'::"text" NOT NULL,
    "matched_count" integer,
    "closed_modal_count" integer DEFAULT 0 NOT NULL,
    "closed_bar_count" integer DEFAULT 0 NOT NULL,
    "counted_at" timestamp with time zone,
    "closed_cleared_at" timestamp with time zone,
    "modal_text" "text" DEFAULT ''::"text" NOT NULL,
    "modal_attachment" "jsonb",
    CONSTRAINT "announcements_age_max_check" CHECK ((("age_max" >= 18) AND ("age_max" <= 100))),
    CONSTRAINT "announcements_age_min_check" CHECK ((("age_min" >= 18) AND ("age_min" <= 100))),
    CONSTRAINT "announcements_bar_close_after_check" CHECK ((("bar_close_after" >= 0) AND ("bar_close_after" <= 60))),
    CONSTRAINT "announcements_bar_html_check" CHECK (("char_length"("bar_html") <= 1000)),
    CONSTRAINT "announcements_check" CHECK ((("ends_at" IS NULL) OR ("starts_at" IS NULL) OR ("ends_at" > "starts_at"))),
    CONSTRAINT "announcements_check1" CHECK ((("age_min" IS NULL) OR ("age_max" IS NULL) OR ("age_min" <= "age_max"))),
    CONSTRAINT "announcements_check2" CHECK ((("presentations_min" IS NULL) OR ("presentations_max" IS NULL) OR ("presentations_min" <= "presentations_max"))),
    CONSTRAINT "announcements_check3" CHECK (("show_modal" OR "show_bar")),
    CONSTRAINT "announcements_check5" CHECK (((NOT "show_bar") OR ("btrim"("bar_html") <> ''::"text"))),
    CONSTRAINT "announcements_education_levels_check" CHECK (("education_levels" <@ ARRAY['bachelor'::"text", 'master'::"text", 'doctorate'::"text", 'other'::"text"])),
    CONSTRAINT "announcements_field_words_check" CHECK ("public"."announcement_words_ok"("field_words")),
    CONSTRAINT "announcements_genders_check" CHECK (("genders" <@ ARRAY['male'::"text", 'female'::"text"])),
    CONSTRAINT "announcements_modal_attachment_check" CHECK ("public"."announcement_attachment_ok"("modal_attachment")),
    CONSTRAINT "announcements_modal_close_after_check" CHECK ((("modal_close_after" >= 0) AND ("modal_close_after" <= 60))),
    CONSTRAINT "announcements_modal_has_content" CHECK (((NOT "show_modal") OR ("btrim"("modal_text") <> ''::"text") OR ("modal_attachment" IS NOT NULL))),
    CONSTRAINT "announcements_modal_size_check" CHECK (("modal_size" = ANY (ARRAY['small'::"text", 'medium'::"text", 'large'::"text"]))),
    CONSTRAINT "announcements_modal_text_check" CHECK (("char_length"("modal_text") <= 5000)),
    CONSTRAINT "announcements_name_check" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 100))),
    CONSTRAINT "announcements_pages_check" CHECK ((("cardinality"("pages") > 0) AND ("pages" <@ ARRAY['all'::"text", 'my_presentations'::"text", 'quizmatter'::"text", 'other_teachers'::"text", 'saved'::"text", 'liked'::"text", 'reviews_submissions'::"text", 'search'::"text", 'presentation_view'::"text", 'editor'::"text", 'account'::"text", 'teacher_profiles'::"text"]))),
    CONSTRAINT "announcements_presentations_max_check" CHECK ((("presentations_max" >= 0) AND ("presentations_max" <= 50))),
    CONSTRAINT "announcements_presentations_min_check" CHECK ((("presentations_min" >= 0) AND ("presentations_min" <= 50))),
    CONSTRAINT "announcements_provinces_check" CHECK ("public"."announcement_provinces_ok"("provinces")),
    CONSTRAINT "announcements_repeat_check" CHECK (("repeat" = ANY (ARRAY['once'::"text", 'daily'::"text", 'every_visit'::"text"]))),
    CONSTRAINT "announcements_roles_check" CHECK (("roles" <@ ARRAY['teacher'::"text", 'editor'::"text", 'admin'::"text"])),
    CONSTRAINT "announcements_town_words_check" CHECK ("public"."announcement_words_ok"("town_words"))
);


ALTER TABLE "public"."announcements" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."announcement_count"("a" "public"."announcements") RETURNS integer
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $$
declare
  today date := public.manila_today();
  wants_presentations boolean := a.presentations_min is not null or a.presentations_max is not null;
begin
  return (
    select count(*)
    from public.user_settings s
    left join (
      select p.owner_id, count(*) as n
      from public.presentations p
      where wants_presentations and p.shared_from is null
      group by p.owner_id
    ) own on own.owner_id = s.user_id
    where not exists (select 1 from public.banned_users b where b.user_id = s.user_id)
      and (coalesce(cardinality(a.genders), 0) = 0 or s.gender = any (a.genders))
      and (a.age_min is null or (s.birth_date is not null and
        extract(year from today)::int - extract(year from s.birth_date)::int
        - case when (extract(month from today), extract(day from today))
            < (extract(month from s.birth_date), extract(day from s.birth_date)) then 1 else 0 end >= a.age_min))
      and (a.age_max is null or (s.birth_date is not null and
        extract(year from today)::int - extract(year from s.birth_date)::int
        - case when (extract(month from today), extract(day from today))
            < (extract(month from s.birth_date), extract(day from s.birth_date)) then 1 else 0 end <= a.age_max))
      and (coalesce(cardinality(a.provinces), 0) = 0 or s.province = any (a.provinces))
      and (coalesce(cardinality(a.town_words), 0) = 0 or (s.town <> '' and exists (
        select 1 from unnest(a.town_words) w where position(lower(w) in lower(s.town)) > 0)))
      and (coalesce(cardinality(a.education_levels), 0) = 0 or s.education_level = any (a.education_levels))
      and (coalesce(cardinality(a.field_words), 0) = 0 or (s.education_field <> '' and exists (
        select 1 from unnest(a.field_words) w where position(lower(w) in lower(s.education_field)) > 0)))
      and (not wants_presentations
        or coalesce(own.n, 0) between coalesce(a.presentations_min, 0) and coalesce(a.presentations_max, 2147483647))
      and (coalesce(cardinality(a.roles), 0) = 0
        or ('editor' = any (a.roles) and exists (select 1 from public.editors e where e.user_id = s.user_id))
        or ('admin' = any (a.roles) and exists (select 1 from public.admins ad where ad.user_id = s.user_id))
        or ('teacher' = any (a.roles)
          and not exists (select 1 from public.editors e where e.user_id = s.user_id)
          and not exists (select 1 from public.admins ad where ad.user_id = s.user_id)))
  );
end;
$$;


ALTER FUNCTION "public"."announcement_count"("a" "public"."announcements") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."announcement_is_live"("a" "public"."announcements") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select a.is_on and (a.starts_at is null or a.starts_at <= now()) and (a.ends_at is null or a.ends_at > now());
$$;


ALTER FUNCTION "public"."announcement_is_live"("a" "public"."announcements") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."announcement_matches"("a" "public"."announcements", "uid" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.user_settings s
    where s.user_id = uid
      and not exists (select 1 from public.banned_users b where b.user_id = uid)
      and (coalesce(cardinality(a.genders), 0) = 0 or s.gender = any (a.genders))
      and (a.age_min is null
        or (s.birth_date is not null and public.age_on(s.birth_date, public.manila_today()) >= a.age_min))
      and (a.age_max is null
        or (s.birth_date is not null and public.age_on(s.birth_date, public.manila_today()) <= a.age_max))
      and (coalesce(cardinality(a.provinces), 0) = 0 or s.province = any (a.provinces))
      and (coalesce(cardinality(a.town_words), 0) = 0 or (s.town <> '' and exists (
        select 1 from unnest(a.town_words) w where position(lower(w) in lower(s.town)) > 0)))
      and (coalesce(cardinality(a.education_levels), 0) = 0 or s.education_level = any (a.education_levels))
      and (coalesce(cardinality(a.field_words), 0) = 0 or (s.education_field <> '' and exists (
        select 1 from unnest(a.field_words) w where position(lower(w) in lower(s.education_field)) > 0)))
      and ((a.presentations_min is null and a.presentations_max is null) or (
        select count(*) from public.presentations p where p.owner_id = uid and p.shared_from is null
      ) between coalesce(a.presentations_min, 0) and coalesce(a.presentations_max, 2147483647))
      and (coalesce(cardinality(a.roles), 0) = 0
        or ('editor' = any (a.roles) and exists (select 1 from public.editors e where e.user_id = uid))
        or ('admin' = any (a.roles) and exists (select 1 from public.admins ad where ad.user_id = uid))
        or ('teacher' = any (a.roles)
          and not exists (select 1 from public.editors e where e.user_id = uid)
          and not exists (select 1 from public.admins ad where ad.user_id = uid)))
  );
$$;


ALTER FUNCTION "public"."announcement_matches"("a" "public"."announcements", "uid" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."announcement_picture_ok"("a" "jsonb") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select coalesce(jsonb_typeof(a -> 'src') = 'string'
    and starts_with(a ->> 'src', 'https://images.quizmatter.com/uploads/')
    and char_length(a ->> 'src') <= 300
    and a ->> 'src' !~ '[\s"''<>]'
    and (not a ? 'width' or (jsonb_typeof(a -> 'width') = 'number'
      and (a ->> 'width')::numeric between 1 and 1920 and (a ->> 'width')::numeric % 1 = 0))
    and (not a ? 'height' or (jsonb_typeof(a -> 'height') = 'number'
      and (a ->> 'height')::numeric between 1 and 1920 and (a ->> 'height')::numeric % 1 = 0)), false);
$$;


ALTER FUNCTION "public"."announcement_picture_ok"("a" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."announcement_text_from_html"("html" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select btrim(
    replace(replace(replace(replace(replace(replace(
      regexp_replace(
        regexp_replace(regexp_replace(coalesce(html, ''), '<br\s*/?>', E'\n', 'gi'), '</p>', E'\n', 'gi'),
        '<[^>]*>', '', 'g'),
      '&lt;', '<'), '&gt;', '>'), '&quot;', '"'), '&#39;', ''''), '&nbsp;', ' '), '&amp;', '&'),
    E'\n ');
$$;


ALTER FUNCTION "public"."announcement_text_from_html"("html" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."approve_submission"("target_id" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  s public.presentation_submissions;
  new_id text := gen_random_uuid()::text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can approve submissions.' using errcode = '42501';
  end if;
  -- "for update": a second Approve (another tab) waits here, then finds it approved.
  select * into s from public.presentation_submissions sub where sub.presentation_id = target_id for update;
  if not found or s.status is distinct from 'submitted' then
    raise exception 'This presentation isn''t waiting for QuizMatter anymore.' using errcode = 'QMSUB';
  end if;
  -- An admin hid it (Admin → Reports) while it waited: hiding gets through the lock, but it mustn't be published.
  if exists (select 1 from public.presentations p where p.id = target_id and p.hidden_at is not null) then
    raise exception 'This presentation is hidden, so it can''t be approved.' using errcode = 'QMHID';
  end if;
  if exists (select 1 from public.banned_users b where b.user_id = s.submitter_id) then
    raise exception 'This editor is banned, so their presentation can''t be approved.' using errcode = 'QMBRV';
  end if;

  -- The computed columns (tags_text, search_text) are left out: the database fills them in.
  insert into public.presentations (
    id, owner_id, title, description, grades, subject, term, week, day, curriculum, learning_competency,
    author, author_id, reference_links, tags, transition, transition_speed, is_published, from_admin, data_version
  )
  select
    new_id, auth.uid(), p.title, p.description, p.grades, p.subject, p.term, p.week, p.day, p.curriculum,
    p.learning_competency,
    -- Always the editor (never what the Author field says), and linked to them, so a rename reaches it.
    coalesce(public.editor_author(s.submitter_id), ''), s.submitter_id,
    p.reference_links, p.tags, p.transition, p.transition_speed, true, true,
    -- The copy has the same slides, so the same version.
    p.data_version
  from public.presentations p
  where p.id = target_id;

  -- Slide ids stay: they only have to be unique inside their own presentation. sync_slide_photos fills
  -- slide_photos for the copy, so the weekly photo cleanup keeps its photos.
  insert into public.slides (presentation_id, id, position, data)
  select new_id, sl.id, sl.position, sl.data
  from public.slides sl
  where sl.presentation_id = target_id;

  update public.presentation_submissions set
    status = 'approved',
    copy_id = new_id,
    decided_at = now(),
    decided_by = auth.uid()
  where presentation_id = target_id;
  return new_id;
end;
$$;


ALTER FUNCTION "public"."approve_submission"("target_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."before_account_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  heir uuid;
begin
  if exists (select 1 from public.presentations p where p.owner_id = old.id and p.from_admin) then
    select a.user_id into heir from public.admins a where a.is_super and a.user_id <> old.id limit 1;
    if heir is null then
      raise exception 'This account owns QuizMatter presentations and there is no other super admin to take them.'
        using errcode = '42501';
    end if;
    -- A presentation under review still changes owner (the review lock lets publish_review's setting through),
    -- and the move isn't counted as anyone's writes.
    perform set_config('quizmatter.publishing_review', 'yes', true);
    perform set_config('quizmatter.write_counted', 'yes', true);
    update public.presentations set owner_id = heir where owner_id = old.id and from_admin;
    perform set_config('quizmatter.publishing_review', '', true);
    perform set_config('quizmatter.write_counted', '', true);
  end if;

  delete from public.presentation_submissions s where s.submitter_id = old.id and s.status <> 'approved';
  return old;
end;
$$;


ALTER FUNCTION "public"."before_account_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_review"("target_id" "text", "by_admin" boolean) RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  update public.presentation_reviews set
    status = 'canceled',
    canceled_by_admin = by_admin,
    ended_at = now(),
    draft = null,
    draft_updated_at = null,
    submitted_fields = null
  where presentation_id = target_id and status in ('reviewing', 'submitted');
$$;


ALTER FUNCTION "public"."cancel_review"("target_id" "text", "by_admin" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_reviews_of_removed_editor"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform public.cancel_review(r.presentation_id, true)
  from public.presentation_reviews r
  where r.reviewer_id = old.user_id and r.status in ('reviewing', 'submitted');
  update public.presentation_submissions set status = 'canceled', decided_at = now()
  where submitter_id = old.user_id and status = 'submitted';
  return old;
end;
$$;


ALTER FUNCTION "public"."cancel_reviews_of_removed_editor"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cap_presentation_data_version"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  new.data_version := least(new.data_version, public.current_data_version());
  return new;
end;
$$;


ALTER FUNCTION "public"."cap_presentation_data_version"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cap_review_draft_version"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  new.draft_version := least(new.draft_version, public.current_data_version());
  return new;
end;
$$;


ALTER FUNCTION "public"."cap_review_draft_version"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_announcement_limit"() RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  perform pg_advisory_xact_lock(hashtext('public.announcements'));
  if (select count(*) from public.announcements a where a.is_on and (a.ends_at is null or a.ends_at > now())) > 20 then
    raise exception 'At most 20 announcements can be on at once.' using errcode = '22023';
  end if;
end;
$$;


ALTER FUNCTION "public"."check_announcement_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_ban_target"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if exists (select 1 from public.admins where user_id = new.user_id) then
    raise exception 'Admins can''t be banned.' using errcode = '42501';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."check_ban_target"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_birth_date"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.birth_date is not null and (
    new.birth_date > public.manila_today()
    or public.age_on(new.birth_date, public.manila_today()) not between 18 and 100
  ) then
    raise exception 'Enter your real birthday. You must be 18 to 100 years old.' using errcode = 'QMAGE';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."check_birth_date"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_editor_target"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if exists (select 1 from public.admins a where a.user_id = new.user_id) then
    raise exception 'Admins can''t be editors.' using errcode = '42501';
  end if;
  if exists (select 1 from public.banned_users b where b.user_id = new.user_id) then
    raise exception 'Banned teachers can''t be editors.' using errcode = '42501';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."check_editor_target"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_folder_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if public.is_banned() then
    raise exception 'This account is banned.' using errcode = 'QMBAN';
  end if;
  -- Two new folders from the same teacher at the same moment wait for each other, so both are counted.
  perform pg_advisory_xact_lock(hashtext(new.owner_id::text));
  if (select count(*) from public.folders f where f.owner_id = new.owner_id) >= 50 then
    raise exception 'You have 50 folders, the most allowed.' using errcode = 'QMFLD';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."check_folder_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_hidden_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  old_hidden_at timestamptz := null;
begin
  if tg_op = 'UPDATE' then
    old_hidden_at := old.hidden_at;
  end if;
  if new.hidden_at is distinct from old_hidden_at and not public.is_admin() then
    raise exception 'Only admins can hide or unhide a presentation.' using errcode = '42501';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."check_hidden_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_hidden_copy_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if auth.uid() is null or pg_trigger_depth() > 1 then
    return old;
  end if;
  if old.shared_from is not null and old.hidden_at is not null and not public.is_admin()
    and exists (select 1 from public.presentations p where p.id = old.shared_from) then
    raise exception 'QuizMatter hid the shared copy, so it can''t be made private.' using errcode = '42501';
  end if;
  return old;
end;
$$;


ALTER FUNCTION "public"."check_hidden_copy_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_maintenance"() RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if current_user = 'service_role'
    or current_setting('request.path', true) = '/rpc/maintenance_status'
    or not (select m.is_on from public.maintenance m where m.id)
  then
    return;
  end if;
  -- Its own step: Postgres checks the right to call is_super_admin() even when an "or" wouldn't need it, and anon
  -- has none.
  if current_user = 'authenticated' then
    if public.is_super_admin() then
      return;
    end if;
  end if;
  -- PostgREST turns this into the answer: HTTP 503 with {"code": "QMMNT", ...} (REFUSALS in
  -- src/lib/presentations.ts, and src/components/MaintenanceWatch.tsx sends the tab to /maintenance).
  raise sqlstate 'PGRST' using
    message = '{"code": "QMMNT", "message": "QuizMatter is under maintenance. Please try again later."}',
    detail = '{"status": 503, "headers": {"Retry-After": "600"}}';
end;
$$;


ALTER FUNCTION "public"."check_maintenance"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_presentation_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if public.is_admin() or new.shared_from is not null then
    return new;
  end if;
  -- save_presentation's "insert … on conflict do update" runs this for existing presentations too: those are
  -- only being saved again, not added.
  if exists (select 1 from public.presentations p where p.id = new.id) then
    return new;
  end if;
  -- Two new presentations from the same teacher at the same moment wait for each other, so both are counted.
  perform pg_advisory_xact_lock(hashtext(new.owner_id::text));
  -- Same as MAX_PRESENTATIONS in src/lib/schema.ts.
  if (select count(*) from public.presentations p where p.owner_id = new.owner_id and p.shared_from is null) >= 50 then
    raise exception 'You have 50 presentations, the most allowed.' using errcode = 'QMMAX';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."check_presentation_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_presentation_review_lock"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  -- tags_text and search_text are worked out by the database (null in NEW here), so they're left out of the comparison.
  ignored text[] := array['hidden_at', 'tags_text', 'search_text', 'author_id']
    || case when coalesce(current_setting('quizmatter.renaming_author', true), '') = 'yes' then array['author'] else '{}' end;
begin
  if coalesce(current_setting('quizmatter.publishing_review', true), '') = 'yes' or not public.is_review_locked(old.id) then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - ignored) = (to_jsonb(old) - ignored) then
    return new;
  end if;
  raise exception 'This presentation is under review.' using errcode = 'QMREV';
end;
$$;


ALTER FUNCTION "public"."check_presentation_review_lock"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_review_draft"("target_id" "text", "review_draft" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
declare
  slide_count int := jsonb_array_length(coalesce(review_draft -> 'slides', '[]'));
begin
  if review_draft ->> 'id' is distinct from target_id then
    raise exception 'The draft is for another presentation.' using errcode = '22023';
  end if;
  if slide_count = 0 or slide_count > 100 then
    raise exception 'A presentation needs 1 to 100 slides.' using errcode = '22023';
  end if;
  if octet_length(review_draft::text) > 5000000 then
    raise exception 'The draft is too big.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(review_draft -> 'slides') as slide
    where jsonb_typeof(slide) <> 'object' or coalesce(slide ->> 'id', '') = '' or octet_length(slide::text) > 2000000
  ) or (
    select count(distinct slide ->> 'id') from jsonb_array_elements(review_draft -> 'slides') as slide
  ) <> slide_count then
    raise exception 'Every slide needs its own id and must be at most 2 MB.' using errcode = '22023';
  end if;
  if not coalesce(
    char_length(review_draft ->> 'title') <= 120
      and char_length(review_draft ->> 'description') <= 1000
      and char_length(review_draft ->> 'subject') <= 80
      and char_length(coalesce(review_draft ->> 'term', '')) <= 40
      and char_length(coalesce(review_draft ->> 'week', '')) <= 40
      and char_length(coalesce(review_draft ->> 'day', '')) <= 40
      and char_length(review_draft ->> 'curriculum') <= 80
      and char_length(review_draft ->> 'learningCompetency') <= 1000
      and jsonb_array_length(coalesce(review_draft -> 'referenceLinks', '[]')) <= 20,
    true
  ) then
    raise exception 'A detail of the draft is too long.' using errcode = '22023';
  end if;
  -- Same limits as MAX_TAGS, MAX_GRADES, SLIDE_TRANSITIONS and SLIDE_EFFECT_SPEED_MIN / _MAX in src/lib/schema.ts
  -- (and the presentations table's checks). A missing one gets publish_review's default, so it passes. The speed is
  -- compared as text, so "2.5" or "fast" is refused here instead of breaking publish_review's number cast.
  if jsonb_array_length(coalesce(review_draft -> 'tags', '[]')) > 10
    or cardinality(public.grades_from(review_draft)) > 14
    or coalesce(review_draft ->> 'transition', 'slide') not in ('none', 'fade', 'slide', 'zoom')
    or coalesce(review_draft ->> 'transitionSpeed', '3') not in ('1', '2', '3', '4', '5') then
    raise exception 'The draft has too many tags or grades, or a slide effect that doesn''t exist.'
      using errcode = '22023';
  end if;
end;
$$;


ALTER FUNCTION "public"."check_review_draft"("target_id" "text", "review_draft" "jsonb") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."presentation_reviews" (
    "presentation_id" "text" NOT NULL,
    "reviewer_id" "uuid",
    "status" "text",
    "draft" "jsonb",
    "draft_updated_at" timestamp with time zone,
    "submitted_fields" "jsonb",
    "admin_note" "text",
    "started_at" timestamp with time zone,
    "submitted_at" timestamp with time zone,
    "ended_at" timestamp with time zone,
    "last_reviewer_id" "uuid",
    "open_to_all" boolean DEFAULT false NOT NULL,
    "canceled_by_admin" boolean DEFAULT false NOT NULL,
    "is_author_update" boolean DEFAULT false NOT NULL,
    "draft_version" integer DEFAULT 0 NOT NULL,
    "first_submitted_at" timestamp with time zone,
    CONSTRAINT "presentation_reviews_admin_note_check" CHECK (("char_length"("admin_note") <= 500)),
    CONSTRAINT "presentation_reviews_status_check" CHECK (("status" = ANY (ARRAY['reviewing'::"text", 'submitted'::"text", 'canceled'::"text", 'published'::"text"])))
);


ALTER TABLE "public"."presentation_reviews" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_review_version"("review" "public"."presentation_reviews", "app_version" integer) RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if coalesce(app_version, 0) < greatest(
    review.draft_version,
    (select p.data_version from public.presentations p where p.id = review.presentation_id)
  ) then
    raise exception 'QuizMatter was updated. Reload the page.' using errcode = 'QMOLD';
  end if;
end;
$$;


ALTER FUNCTION "public"."check_review_version"("review" "public"."presentation_reviews", "app_version" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_shared_copy_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if coalesce(current_setting('quizmatter.sharing', true), '') = 'yes' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.shared_from is null and new.shared_at is null then
      return new;
    end if;
  elsif old.shared_from is null then
    -- An original can't be turned into a copy.
    if new.shared_from is null and new.shared_at is not distinct from old.shared_at then
      return new;
    end if;
  -- tags_text and search_text are worked out by the database (null in NEW here), so they're left out.
  elsif (to_jsonb(new) - 'hidden_at' - 'tags_text' - 'search_text') = (to_jsonb(old) - 'hidden_at' - 'tags_text' - 'search_text') then
    return new;
  end if;
  raise exception 'A shared copy only changes with "Update shared presentation".' using errcode = '42501';
end;
$$;


ALTER FUNCTION "public"."check_shared_copy_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_shared_copy_slides"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  target_id text := case tg_op when 'DELETE' then old.presentation_id else new.presentation_id end;
begin
  if coalesce(current_setting('quizmatter.sharing', true), '') <> 'yes'
    and exists (select 1 from public.presentations p where p.id = target_id and p.shared_from is not null) then
    raise exception 'A shared copy only changes with "Update shared presentation".' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;


ALTER FUNCTION "public"."check_shared_copy_slides"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_slide_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if current_user <> 'authenticated'
    or (tg_op = 'UPDATE' and new.presentation_id = old.presentation_id)
    -- save_presentation's "insert … on conflict do update" runs this for slides already saved too: those are only
    -- being saved again, not added.
    or exists (select 1 from public.slides s where s.presentation_id = new.presentation_id and s.id = new.id) then
    return new;
  end if;
  -- Two writes to the same presentation at the same moment wait for each other, so both are counted (the same
  -- lock save_presentation takes).
  perform 1 from public.presentations p where p.id = new.presentation_id for update;
  if (select count(*) from public.slides s where s.presentation_id = new.presentation_id) >= 100 then
    raise exception 'A presentation can have at most 100 slides.' using errcode = '22023';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."check_slide_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_slide_review_lock"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  target_id text := case tg_op when 'DELETE' then old.presentation_id else new.presentation_id end;
begin
  if coalesce(current_setting('quizmatter.publishing_review', true), '') <> 'yes' and public.is_review_locked(target_id) then
    raise exception 'This presentation is under review.' using errcode = 'QMREV';
  end if;
  return coalesce(new, old);
end;
$$;


ALTER FUNCTION "public"."check_slide_review_lock"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_submission_not_copy"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if exists (select 1 from public.presentations p where p.id = new.presentation_id and p.shared_from is not null) then
    raise exception 'Send the presentation itself, not its shared copy.' using errcode = 'QMSUB';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."check_submission_not_copy"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_display_name"("slug" "text", "me" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if slug = '' then
    return false;
  end if;

  update public.user_settings s
  set display_name = '', updated_at = now()
  from auth.users u
  where u.id = s.user_id
    and s.profile_slug = claim_display_name.slug
    and s.user_id <> me
    and u.email_confirmed_at is null;

  return not exists (
    select 1 from public.user_settings s where s.profile_slug = claim_display_name.slug and s.user_id <> me
  );
end;
$$;


ALTER FUNCTION "public"."claim_display_name"("slug" "text", "me" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_announcement_dismissals"("batch_size" integer DEFAULT 50000) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  deleted int;
begin
  -- Keep the closed counts of each announcement newly over 30 days past its end (once).
  update public.announcements x set
    closed_modal_count = (select count(*) from public.announcement_dismissals d
      where d.announcement_id = x.id and d.part = 'modal'),
    closed_bar_count = (select count(*) from public.announcement_dismissals d
      where d.announcement_id = x.id and d.part = 'bar'),
    closed_cleared_at = now()
  where x.ends_at <= now() - interval '30 days' and x.closed_cleared_at is null;

  delete from public.announcement_dismissals d
  where d.ctid in (
    select d2.ctid
    from public.announcement_dismissals d2
    join public.announcements a on a.id = d2.announcement_id
    where a.closed_cleared_at is not null and a.ends_at <= now() - interval '30 days'
    limit batch_size
  );
  get diagnostics deleted = row_count;
  return deleted;
end;
$$;


ALTER FUNCTION "public"."cleanup_announcement_dismissals"("batch_size" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."count_announcement"("target" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  a public.announcements;
begin
  select * into a from public.announcements where id = target;
  if not found then
    return;
  end if;
  update public.announcements x set
    matched_count = public.announcement_count(a),
    closed_modal_count = case when x.closed_cleared_at is null then (select count(*) from public.announcement_dismissals d
      where d.announcement_id = target and d.part = 'modal') else x.closed_modal_count end,
    closed_bar_count = case when x.closed_cleared_at is null then (select count(*) from public.announcement_dismissals d
      where d.announcement_id = target and d.part = 'bar') else x.closed_bar_count end,
    counted_at = now()
  where x.id = target;
end;
$$;


ALTER FUNCTION "public"."count_announcement"("target" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."count_click"("feature" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
#variable_conflict use_column
declare
  lim public.click_limits;
  last_pause timestamptz;
  last_streak int;
  streak int;
  user_clicks int;
  minutes int;
  -- A daily limit's count starts again when the date changes (in its time zone); else after per_seconds.
  is_new_window boolean;
  next_midnight timestamptz;
begin
  if auth.uid() is null or public.is_super_admin() then
    return;
  end if;
  select * into lim from public.click_limits l where l.feature = count_click.feature;
  if not found then
    raise exception 'Unknown feature.' using errcode = '22023';
  end if;

  -- "for update": two clicks at the same moment wait for each other, so both are counted.
  select r.paused_until, r.pause_streak into last_pause, last_streak
  from public.click_rate r
  where r.user_id = auth.uid() and r.feature = count_click.feature
  for update;
  if last_pause > now() then
    raise exception 'Too many clicks. Try again later.'
      using errcode = 'QMBLK', detail = (extract(epoch from last_pause) * 1000)::bigint::text;
  end if;

  select case
      when lim.daily_reset_time_zone is not null
        then (r.window_start at time zone lim.daily_reset_time_zone)::date < (now() at time zone lim.daily_reset_time_zone)::date
      else r.window_start < now() - make_interval(secs => lim.per_seconds)
    end
  into is_new_window
  from public.click_rate r
  where r.user_id = auth.uid() and r.feature = count_click.feature;

  insert into public.click_rate as r (user_id, feature, window_start, clicks)
  values (auth.uid(), count_click.feature, now(), 1)
  on conflict (user_id, feature) do update set
    window_start = case when is_new_window then now() else r.window_start end,
    clicks = case when is_new_window then 1 else r.clicks + 1 end
  returning clicks into user_clicks;

  if user_clicks < lim.max_clicks then
    return;
  end if;

  -- This click reached the limit. It still goes through, so the pause (or ban) is saved with it.
  streak := case
    when last_pause > now() - make_interval(hours => lim.repeat_within_hours) then coalesce(last_streak, 0) + 1
    else 1
  end;

  -- A plain admin is paused like a teacher, but never banned automatically.
  if streak >= lim.ban_after_pauses and not public.is_admin() then
    insert into public.banned_users (user_id, reason, is_automatic)
    values (
      auth.uid(),
      format('Automatic ban: clicked %s too fast %s times, each within %s hours of the last.',
        lim.label, streak, lim.repeat_within_hours),
      true
    )
    on conflict (user_id) do nothing;
    -- Supabase's own ban, like an admin ban (banTeacher): 100 years, so until an admin unbans. Their login stops
    -- working within the hour.
    update auth.users set banned_until = now() + interval '876000 hours' where id = auth.uid();
    -- After an Unban they start from nothing, not one burst away from the next ban.
    update public.click_rate r set clicks = 0, window_start = now(), paused_until = null, pause_streak = 0
    where r.user_id = auth.uid();
    insert into public.click_history (user_id, feature, kind, streak)
    values (auth.uid(), count_click.feature, 'ban', streak);
  else
    if lim.daily_reset_time_zone is not null then
      -- A daily limit pauses until the next midnight in its time zone.
      next_midnight := ((now() at time zone lim.daily_reset_time_zone)::date + 1)::timestamp at time zone lim.daily_reset_time_zone;
      minutes := ceil(extract(epoch from next_midnight - now()) / 60)::int;
    else
      minutes := case when streak > 1 then lim.repeat_pause_minutes else lim.first_pause_minutes end;
      next_midnight := null;
    end if;
    update public.click_rate r set
      clicks = 0,
      window_start = now(),
      pause_streak = streak,
      paused_until = coalesce(next_midnight, now() + make_interval(mins => minutes))
    where r.user_id = auth.uid() and r.feature = count_click.feature;
    insert into public.click_history (user_id, feature, kind, pause_minutes, streak)
    values (auth.uid(), count_click.feature, 'pause', minutes, streak);
  end if;
end;
$$;


ALTER FUNCTION "public"."count_click"("feature" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."count_like"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if tg_op = 'INSERT' then
    insert into public.presentation_like_counts as c (presentation_id, total) values (new.presentation_id, 1)
    on conflict (presentation_id) do update set total = c.total + 1;
    return new;
  end if;
  -- The presentation itself may be going (its count row goes with it): then this updates nothing.
  update public.presentation_like_counts c set total = greatest(c.total - 1, 0) where c.presentation_id = old.presentation_id;
  return old;
end;
$$;


ALTER FUNCTION "public"."count_like"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."count_new_presentation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  -- save_presentation's "insert … on conflict do update" runs this for existing presentations too: those are only
  -- being saved again, not made. A shared copy is counted as a share instead (share_presentation).
  if new.from_admin or new.shared_from is not null or exists (select 1 from public.presentations p where p.id = new.id) then
    return new;
  end if;
  perform public.count_click('create');
  return new;
end;
$$;


ALTER FUNCTION "public"."count_new_presentation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."count_photo_upload"() RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  perform public.count_click('photo_upload');
  perform public.count_click('photo_upload_daily');
end;
$$;


ALTER FUNCTION "public"."count_photo_upload"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."count_photo_write"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if current_user = 'authenticated' then
    if public.is_banned() then
      raise exception 'This account is banned.' using errcode = 'QMBAN';
    end if;
    perform public.count_click('photo_rows');
    perform public.count_click('photo_rows_daily');
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."count_photo_write"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."count_presentation_write"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if auth.uid() is null then
    return null;
  end if;
  if coalesce(current_setting('quizmatter.write_counted', true), '') <> 'yes' then
    perform set_config('quizmatter.write_counted', 'yes', true);
    if public.is_banned() then
      raise exception 'This account is banned.' using errcode = 'QMBAN';
    end if;
    perform public.count_click('presentation_save');
    perform public.count_click('presentation_save_daily');
  end if;
  return null;
end;
$$;


ALTER FUNCTION "public"."count_presentation_write"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."count_share_clicks"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.from_admin or new.shared_from is not null or not new.is_published then
    return new;
  end if;
  raise exception 'Publish with the Share button: it makes a shared copy.' using errcode = '42501';
end;
$$;


ALTER FUNCTION "public"."count_share_clicks"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."count_table_write"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  feature text := tg_argv[0];
  flag text := 'quizmatter.counted_' || tg_argv[0];
begin
  if auth.uid() is null or current_user <> 'authenticated' then
    return null;
  end if;
  if coalesce(current_setting(flag, true), '') <> 'yes' then
    perform set_config(flag, 'yes', true);
    perform public.count_click(feature);
    perform public.count_click(feature || '_daily');
  end if;
  return null;
end;
$$;


ALTER FUNCTION "public"."count_table_write"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."count_write"("kind" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
#variable_conflict use_column
declare
  user_writes int;
begin
  if count_write.kind not in ('presentations', 'photos', 'saved', 'photo_rows') then
    raise exception 'Unknown kind of write.' using errcode = '22023';
  end if;
  if auth.uid() is null or public.is_super_admin() then
    return;
  end if;
  if exists (select 1 from public.banned_users where user_id = auth.uid()) then
    raise exception 'This account is banned.' using errcode = 'QMBAN';
  end if;

  insert into public.write_rate as w (user_id, kind, window_start, writes)
  values (auth.uid(), count_write.kind, now(), 1)
  on conflict (user_id, kind) do update set
    window_start = case when w.window_start < now() - interval '1 minute' then now() else w.window_start end,
    writes = case when w.window_start < now() - interval '1 minute' then 1 else w.writes + 1 end
  returning w.writes into user_writes;

  if user_writes > 30 then
    raise exception 'Too many saves. Wait a minute and try again.' using errcode = 'QM429';
  end if;
end;
$$;


ALTER FUNCTION "public"."count_write"("kind" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_data_version"() RETURNS integer
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  -- Same as DATA_VERSION in src/lib/schema.ts.
  select 0;
$$;


ALTER FUNCTION "public"."current_data_version"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_announcement"("target" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  deleted_name text;
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;

  delete from public.announcements where id = target returning name into deleted_name;
  if deleted_name is not null then
    perform public.log_admin_action('announcement_deleted', 'announcement', target::text, deleted_name, null);
  end if;
end;
$$;


ALTER FUNCTION "public"."delete_announcement"("target" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dismiss_announcement"("target" "uuid", "part" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if auth.uid() is null then
    raise exception 'Please log in.' using errcode = '42501';
  end if;
  if part is null or part not in ('modal', 'bar') then
    raise exception 'Unknown part.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.announcements a
    where a.id = target and a.repeat <> 'every_visit' and public.announcement_is_live(a)
  ) then
    return;
  end if;

  insert into public.announcement_dismissals (announcement_id, user_id, part, closed_at)
  values (target, auth.uid(), dismiss_announcement.part, now())
  on conflict on constraint announcement_dismissals_pkey do update set closed_at = excluded.closed_at;
end;
$$;


ALTER FUNCTION "public"."dismiss_announcement"("target" "uuid", "part" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."drop_unapproved_submission"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  delete from public.presentation_submissions s
  where s.presentation_id = old.id and s.status in ('sent_back', 'canceled');
  return old;
end;
$$;


ALTER FUNCTION "public"."drop_unapproved_submission"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."drop_waiting_editor_photo"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  next_owner uuid;
begin
  if not exists (
    select 1 from public.shared_photos sp where sp.src = old.src and not sp.is_public and sp.uploaded_by = old.user_id
  ) then
    return null;
  end if;
  select p.user_id into next_owner
  from public.photos p
  join public.editors e on e.user_id = p.user_id
  where p.src = old.src
  order by p.created_at
  limit 1;
  if next_owner is null then
    delete from public.shared_photos sp where sp.src = old.src and not sp.is_public and sp.uploaded_by = old.user_id;
  else
    update public.shared_photos sp set uploaded_by = next_owner
    where sp.src = old.src and not sp.is_public and sp.uploaded_by = old.user_id;
  end if;
  return null;
end;
$$;


ALTER FUNCTION "public"."drop_waiting_editor_photo"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."editor_author"("user_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  -- Same limit as DETAIL_MAX_LENGTH.author in src/lib/schema.ts.
  select left(coalesce(nullif(trim(st.display_name), ''), split_part(u.email, '@', 1), ''), 120)
  from auth.users u
  left join public.user_settings st on st.user_id = u.id
  where u.id = editor_author.user_id;
$$;


ALTER FUNCTION "public"."editor_author"("user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."editor_presentations"("slug" "text") RETURNS TABLE("id" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  with person as (
    select st.user_id
    from public.user_settings st
    where editor_presentations.slug <> '' and st.profile_slug = editor_presentations.slug
      and public.profile_is_visible(st.user_id)
  )
  select p.id
  from person
  join public.presentation_submissions s on s.submitter_id = person.user_id and s.status = 'approved'
  join public.presentations p on p.id = s.copy_id
  where p.from_admin and p.is_published and p.hidden_at is null
  limit 200;
$$;


ALTER FUNCTION "public"."editor_presentations"("slug" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."grades_from"("details" "jsonb") RETURNS "text"[]
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select case
    when jsonb_typeof(details -> 'grades') = 'array' then array(select jsonb_array_elements_text(details -> 'grades'))
    when coalesce(details ->> 'grade', '') <> '' then array[details ->> 'grade']
    else '{}'::text[]
  end;
$$;


ALTER FUNCTION "public"."grades_from"("details" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_admin_presentation_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if current_user <> 'authenticated' or public.is_super_admin() then
    return new;
  end if;
  if new.owner_id is distinct from old.owner_id or new.from_admin is distinct from old.from_admin then
    raise exception 'Only the super admin can change who owns a presentation or move it to QuizMatter.'
      using errcode = '42501';
  end if;
  -- tags_text and search_text are worked out by the database (null in NEW here), so they're left out.
  if old.owner_id is distinct from auth.uid()
    and (to_jsonb(new) - 'hidden_at' - 'tags_text' - 'search_text') <> (to_jsonb(old) - 'hidden_at' - 'tags_text' - 'search_text') then
    raise exception 'Admins can only hide or show someone else''s presentation.' using errcode = '42501';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."guard_admin_presentation_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."guard_display_name"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if (select auth.uid()) = coalesce(new.user_id, old.user_id)
    and coalesce(current_setting('qm.set_display_name', true), '') <> 'on'
    -- In brackets: a bare "then" inside the case would end the if's condition early.
    and (case tg_op
      when 'DELETE' then true
      when 'INSERT' then new.display_name <> '' or new.display_name_changed_at is not null
      else new.display_name is distinct from old.display_name
        or new.display_name_changed_at is distinct from old.display_name_changed_at
    end)
  then
    raise exception 'Change your display name on the Account page.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;


ALTER FUNCTION "public"."guard_display_name"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  given_name text := trim(coalesce(new.raw_user_meta_data ->> 'first_name', ''));
  family_name text := trim(coalesce(new.raw_user_meta_data ->> 'last_name', ''));
  base_name text := trim(given_name || ' ' || family_name);
  new_name text := base_name;
  agreed_version text := nullif(trim(coalesce(new.raw_user_meta_data ->> 'terms_version', '')), '');
  birth_text text := coalesce(new.raw_user_meta_data ->> 'birth_date', '');
  birth date;
  given_gender text := coalesce(new.raw_user_meta_data ->> 'gender', '');
  given_province text := coalesce(new.raw_user_meta_data ->> 'province', '');
begin
  if public.profile_slug(base_name) = '' then
    base_name := 'Teacher';
    new_name := '';
  end if;

  if not public.claim_display_name(public.profile_slug(new_name), new.id) then
    for attempt in 1..20 loop
      new_name := base_name || ' ' || public.random_name_ending();
      exit when public.claim_display_name(public.profile_slug(new_name), new.id);
    end loop;
  end if;

  -- A bad detail is saved empty, so the account is still made (the form checks them first).
  if birth_text ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      birth := birth_text::date;
    exception when others then
      birth := null;
    end;
  end if;
  if birth is not null and (birth > public.manila_today()
      or public.age_on(birth, public.manila_today()) not between 18 and 100) then
    birth := null;
  end if;
  if given_gender not in ('male', 'female') then
    given_gender := '';
  end if;
  if not public.is_province(given_province) then
    given_province := '';
  end if;
  insert into public.user_settings
    (user_id, display_name, first_name, last_name, contact_number, education_level, education_field,
     terms_version, terms_accepted_at, birth_date, gender, province, town)
  values (
    new.id,
    new_name,
    given_name,
    family_name,
    trim(coalesce(new.raw_user_meta_data ->> 'contact_number', '')),
    coalesce(new.raw_user_meta_data ->> 'education_level', ''),
    trim(coalesce(new.raw_user_meta_data ->> 'education_field', '')),
    agreed_version,
    case when agreed_version is not null then now() end,
    birth,
    given_gender,
    given_province,
    left(trim(coalesce(new.raw_user_meta_data ->> 'town', '')), 60)
  )
  on conflict (user_id) do nothing;

  update auth.users
  set raw_user_meta_data = raw_user_meta_data - array['first_name', 'last_name', 'contact_number',
    'education_level', 'education_field', 'display_name', 'terms_version', 'birth_date', 'gender', 'province',
    'town']
  where id = new.id;
  return new;
end;
$_$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_publishable_content"("target_id" "text") RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1 from public.presentations p
    where p.id = target_id and btrim(p.title) <> ''
  ) and exists (
    select 1 from public.slides s
    where s.presentation_id = target_id and (
      btrim(coalesce(s.data ->> 'question', '')) <> ''
      or jsonb_array_length(coalesce(s.data -> 'elements', '[]')) > 0
      or coalesce(s.data ->> 'embedUrl', '') <> ''
      or btrim(coalesce(s.data ->> 'correctAnswer', '')) <> ''
      or exists (select 1 from jsonb_array_elements(coalesce(s.data -> 'options', '[]')) o where btrim(coalesce(o ->> 'text', '')) <> '')
    )
  );
$$;


ALTER FUNCTION "public"."has_publishable_content"("target_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."hook_before_user_created"("event" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  client_ip inet;
  -- What comes after the last "@", in small letters (like the sign up page). No email (e.g. a phone sign up): ''.
  email_domain text := lower(split_part(coalesce(event -> 'user' ->> 'email', ''), '@', -1));
begin
  if (public.maintenance_status() ->> 'is_on')::boolean then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 503,
      'message', 'QuizMatter is under maintenance. Please try again later.'
    ));
  end if;

  -- A throwaway email service: refused, whatever the internet address. Same words as THROWAWAY_EMAIL_MESSAGE in
  -- src/lib/userSettings.ts, so the sign up page shows them.
  if exists (select 1 from public.blocked_email_domains b where b.domain = email_domain) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 400,
      'message', 'Please use your real email address (school or personal), not a throwaway one.'
    ));
  end if;

  -- No address, or one Postgres can't read (shouldn't happen): allow, rather than block everyone.
  begin
    client_ip := nullif(event -> 'metadata' ->> 'ip_address', '')::inet;
  exception when others then
    client_ip := null;
  end;
  if client_ip is null then
    return '{}'::jsonb;
  end if;

  if (
    select count(*) from public.sign_up_attempts a
    where a.ip = client_ip and a.created_at > now() - interval '1 hour'
  ) >= 10 then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 429,
      'message', 'Too many accounts were made from this internet connection. Please try again in an hour.'
    ));
  end if;

  insert into public.sign_up_attempts (ip) values (client_ip);
  return '{}'::jsonb;
end;
$$;


ALTER FUNCTION "public"."hook_before_user_created"("event" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_banned"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (select 1 from public.banned_users where user_id = (select auth.uid()));
$$;


ALTER FUNCTION "public"."is_banned"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_editor"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (select 1 from public.editors where user_id = (select auth.uid()));
$$;


ALTER FUNCTION "public"."is_editor"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_province"("name" "text") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select name = any (array[
    -- provinces:start
    'Abra', 'Agusan del Norte', 'Agusan del Sur', 'Aklan', 'Albay', 'Antique', 'Apayao', 'Aurora', 'Basilan',
    'Bataan', 'Batanes', 'Batangas', 'Benguet', 'Biliran', 'Bohol', 'Bukidnon', 'Bulacan', 'Cagayan',
    'Camarines Norte', 'Camarines Sur', 'Camiguin', 'Capiz', 'Catanduanes', 'Cavite', 'Cebu', 'Cotabato',
    'Davao de Oro', 'Davao del Norte', 'Davao del Sur', 'Davao Occidental', 'Davao Oriental', 'Dinagat Islands',
    'Eastern Samar', 'Guimaras', 'Ifugao', 'Ilocos Norte', 'Ilocos Sur', 'Iloilo', 'Isabela', 'Kalinga', 'La Union',
    'Laguna', 'Lanao del Norte', 'Lanao del Sur', 'Leyte', 'Maguindanao del Norte', 'Maguindanao del Sur',
    'Marinduque', 'Masbate', 'Metro Manila', 'Misamis Occidental', 'Misamis Oriental', 'Mountain Province',
    'Negros Occidental', 'Negros Oriental', 'Northern Samar', 'Nueva Ecija', 'Nueva Vizcaya', 'Occidental Mindoro',
    'Oriental Mindoro', 'Palawan', 'Pampanga', 'Pangasinan', 'Quezon', 'Quirino', 'Rizal', 'Romblon', 'Samar',
    'Sarangani', 'Siquijor', 'Sorsogon', 'South Cotabato', 'Southern Leyte', 'Sultan Kudarat', 'Sulu',
    'Surigao del Norte', 'Surigao del Sur', 'Tarlac', 'Tawi-Tawi', 'Zambales', 'Zamboanga del Norte',
    'Zamboanga del Sur', 'Zamboanga Sibugay', 'Outside the Philippines'
    -- provinces:end
  ]);
$$;


ALTER FUNCTION "public"."is_province"("name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_review_locked"("target_id" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1 from public.presentation_reviews r
    where r.presentation_id = target_id and r.status in ('reviewing', 'submitted') and r.reviewer_id is not null
  ) or exists (
    select 1 from public.presentation_submissions s
    join auth.users u on u.id = s.submitter_id
    where s.presentation_id = target_id and s.status = 'submitted'
  );
$$;


ALTER FUNCTION "public"."is_review_locked"("target_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_super_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()) and is_super);
$$;


ALTER FUNCTION "public"."is_super_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keep_author_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.author_id := null;
    else
      new.author_id := old.author_id;
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."keep_author_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keep_copied_from"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if tg_op = 'UPDATE' then
    new.copied_from := old.copied_from;
  elsif new.copied_from is not null
    and (new.copied_from = new.id or not exists (select 1 from public.presentations p where p.id = new.copied_from)) then
    new.copied_from := null;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."keep_copied_from"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keep_editor_category"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if lower(old.name) = 'from editors' and (tg_op = 'DELETE' or new.name is distinct from old.name) then
    raise exception 'This category holds editors'' photos, so it can''t be renamed or deleted.'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."keep_editor_category"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keep_terms_consent"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.terms_version := null;
      new.terms_accepted_at := null;
    else
      new.terms_version := old.terms_version;
      new.terms_accepted_at := old.terms_accepted_at;
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."keep_terms_consent"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lesson_editor"("target_id" "text") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select s.submitter_id
  from public.presentation_submissions s
  join public.presentations p on p.id = s.copy_id
  where s.copy_id = target_id and s.status = 'approved' and p.from_admin and p.is_published and p.hidden_at is null;
$$;


ALTER FUNCTION "public"."lesson_editor"("target_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lesson_extras"("target_id" "text") RETURNS TABLE("id" "text", "kind" "text", "editor_name" "text", "editor_slug" "text", "position" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  with week as (
    select * from public.lesson_week(target_id)
  ),
  candidates as (
    select p.id, p.created_at
    from public.presentations t
    join public.presentations p
      on p.from_admin and p.is_published and p.hidden_at is null
      and p.subject = t.subject and p.grades && t.grades and p.id <> t.id
    where t.id = target_id and t.from_admin and t.is_published and t.hidden_at is null and t.subject <> ''
      and not exists (select 1 from week w where w.id = p.id)
  ),
  saves as (
    select sv.presentation_id, count(*) as total
    from public.saved_presentations sv
    join candidates c on c.id = sv.presentation_id
    group by sv.presentation_id
  ),
  suggestions as (
    select c.id, row_number() over (order by coalesce(s.total, 0) desc, c.created_at desc)::int as "position"
    from candidates c
    left join saves s on s.presentation_id = c.id
  )
  select w.id, 'week', w.editor_name, w.editor_slug, 0 from week w
  union all
  select s.id, 'suggestion', '', '', s."position" from suggestions s where s."position" <= 6;
$$;


ALTER FUNCTION "public"."lesson_extras"("target_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lesson_week"("target_id" "text") RETURNS TABLE("id" "text", "editor_name" "text", "editor_slug" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  with editor as (
    select public.lesson_editor(target_id) as user_id
  ),
  target as (
    select p.* from public.presentations p, editor e
    where p.id = target_id and e.user_id is not null and public.profile_is_visible(e.user_id)
  ),
  lessons as (
    select t.id from target t
    union
    select p.id
    from target t
    join public.presentation_submissions s on s.status = 'approved' and s.submitter_id = (select user_id from editor)
    join public.presentations p on p.id = s.copy_id
    where p.from_admin and p.is_published and p.hidden_at is null
      and t.subject <> '' and t.term <> '' and t.week <> ''
      and p.subject = t.subject and p.term = t.term and p.week = t.week and p.grades && t.grades
  )
  select
    l.id,
    coalesce(nullif(trim(st.display_name), ''), split_part(u.email, '@', 1), ''),
    coalesce(st.profile_slug, '')
  from lessons l
  cross join editor e
  join auth.users u on u.id = e.user_id
  left join public.user_settings st on st.user_id = e.user_id;
$$;


ALTER FUNCTION "public"."lesson_week"("target_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_admin_action"("action" "text", "target_type" "text", "target_id" "text", "target_title" "text", "details" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if coalesce(current_setting('quizmatter.admin_logged', true), '') = 'yes' or not public.is_admin() then
    return;
  end if;
  insert into public.admin_actions (admin_id, admin_name, action, target_type, target_id, target_title, details)
  values (
    auth.uid(), coalesce(public.admin_log_name(), ''), log_admin_action.action, log_admin_action.target_type,
    log_admin_action.target_id, coalesce(log_admin_action.target_title, ''), log_admin_action.details
  );
  perform set_config('quizmatter.admin_logged', 'yes', true);
end;
$$;


ALTER FUNCTION "public"."log_admin_action"("action" "text", "target_type" "text", "target_id" "text", "target_title" "text", "details" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_ban"("target" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  ban_reason text;
  last_action text;
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;
  select b.reason into ban_reason from public.banned_users b where b.user_id = target;
  if not found then
    raise exception 'This teacher isn''t banned.' using errcode = 'P0002';
  end if;
  select a.action into last_action
  from public.admin_actions a
  where a.target_id = target::text and a.action in ('teacher_banned', 'ban_updated', 'teacher_unbanned')
  order by a.created_at desc, a.id desc
  limit 1;
  perform public.log_admin_action(
    case when last_action is not null and last_action <> 'teacher_unbanned' then 'ban_updated' else 'teacher_banned' end,
    'user', target::text, (select u.email from auth.users u where u.id = target),
    jsonb_build_object('reason', ban_reason)
  );
end;
$$;


ALTER FUNCTION "public"."log_ban"("target" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_category_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if tg_op = 'INSERT' then
    perform public.log_admin_action('category_created', 'category', new.id::text, new.name, null);
    return new;
  elsif tg_op = 'UPDATE' then
    if new.name is distinct from old.name then
      perform public.log_admin_action(
        'category_renamed', 'category', new.id::text, new.name, jsonb_build_object('old_name', old.name)
      );
    end if;
    return new;
  end if;
  perform public.log_admin_action('category_deleted', 'category', old.id::text, old.name, null);
  return old;
end;
$$;


ALTER FUNCTION "public"."log_category_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_click_release"("target" "uuid", "feature" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.click_limits c where c.feature = log_click_release.feature) then
    raise exception 'Unknown feature.' using errcode = '22023';
  end if;
  perform public.log_admin_action(
    'pause_released', 'user', target::text, (select u.email from auth.users u where u.id = target),
    jsonb_build_object('feature', log_click_release.feature)
  );
end;
$$;


ALTER FUNCTION "public"."log_click_release"("target" "uuid", "feature" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_editor_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  who uuid := case when tg_op = 'INSERT' then new.user_id else old.user_id end;
  email text := (select u.email from auth.users u where u.id = who);
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.editors e where e.user_id = new.user_id) then
      perform public.log_admin_action('editor_added', 'user', who::text, email, null);
    end if;
    return new;
  end if;
  perform public.log_admin_action('editor_removed', 'user', who::text, email, null);
  return old;
end;
$$;


ALTER FUNCTION "public"."log_editor_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_presentation_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  action text;
begin
  if new.from_admin and not old.from_admin then
    action := 'presentation_moved';
  elsif new.from_admin and new.is_published is distinct from old.is_published then
    action := case when new.is_published then 'presentation_shared' else 'presentation_unshared' end;
  elsif (new.hidden_at is null) <> (old.hidden_at is null) then
    action := case when new.hidden_at is null then 'presentation_unhidden' else 'presentation_hidden' end;
  end if;
  if action is not null then
    if pg_trigger_depth() = 1 then
      perform set_config('quizmatter.admin_logged', '', true);
    end if;
    perform public.log_admin_action(action, 'presentation', new.id, new.title, null);
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."log_presentation_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_presentation_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if pg_trigger_depth() > 1 or not public.is_admin() or not (old.from_admin or old.owner_id <> auth.uid()) then
    return old;
  end if;
  perform set_config('quizmatter.admin_logged', '', true);
  perform public.log_admin_action('presentation_deleted', 'presentation', old.id, old.title, null);
  return old;
end;
$$;


ALTER FUNCTION "public"."log_presentation_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_reports_dismissed"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if coalesce(current_setting('quizmatter.admin_logged', true), '') = 'yes' or not public.is_admin() then
    return null;
  end if;
  insert into public.admin_actions (admin_id, admin_name, action, target_type, target_id, target_title, details)
  select auth.uid(), coalesce(public.admin_log_name(), ''), 'reports_dismissed', 'presentation', p.id, p.title,
         jsonb_build_object('count', r.total)
  from (select o.presentation_id, count(*) as total from old_reports o group by o.presentation_id) r
  join public.presentations p on p.id = r.presentation_id;
  if found then
    perform set_config('quizmatter.admin_logged', 'yes', true);
  end if;
  return null;
end;
$$;


ALTER FUNCTION "public"."log_reports_dismissed"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_review_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  title text := (select p.title from public.presentations p where p.id = new.presentation_id);
begin
  if tg_op = 'INSERT' then
    -- A new row starts closed (open_to_all defaults to false), so only opening it is a change.
    if new.open_to_all then
      perform public.log_admin_action('review_opened', 'presentation', new.presentation_id, title, null);
    end if;
  elsif old.status = 'submitted' and new.status = 'published' then
    perform public.log_admin_action('review_published', 'presentation', new.presentation_id, title, null);
  elsif old.status = 'submitted' and new.status = 'reviewing' then
    perform public.log_admin_action(
      'review_sent_back', 'presentation', new.presentation_id, title, jsonb_build_object('note', new.admin_note)
    );
  elsif new.status = 'canceled' and old.status is distinct from 'canceled' then
    -- A reviewer's own Stop review isn't logged: log_admin_action only logs admins.
    perform public.log_admin_action('review_canceled', 'presentation', new.presentation_id, title, null);
  elsif new.open_to_all is distinct from old.open_to_all then
    perform public.log_admin_action(
      case when new.open_to_all then 'review_opened' else 'review_closed' end,
      'presentation', new.presentation_id, title, null
    );
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."log_review_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_shared_photo_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if pg_trigger_depth() = 1 then
    perform set_config('quizmatter.admin_logged', '', true);
  end if;
  perform public.log_admin_action('photo_deleted', 'photo', old.src, old.file_name, null);
  return old;
end;
$$;


ALTER FUNCTION "public"."log_shared_photo_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_submission_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  title text;
begin
  if new.status is not distinct from old.status or new.status not in ('approved', 'sent_back') then
    return new;
  end if;
  title := coalesce(
    nullif(new.title, ''), (select p.title from public.presentations p where p.id = new.presentation_id)
  );
  if new.status = 'approved' then
    perform public.log_admin_action(
      'submission_approved', 'presentation', coalesce(new.copy_id, new.presentation_id), title, null
    );
  else
    perform public.log_admin_action(
      'submission_sent_back', 'presentation', new.presentation_id, title, jsonb_build_object('note', new.admin_note)
    );
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."log_submission_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_unban"("target" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;
  if exists (select 1 from public.banned_users b where b.user_id = target) then
    raise exception 'This teacher is still banned.' using errcode = '22023';
  end if;
  perform public.log_admin_action(
    'teacher_unbanned', 'user', target::text, (select u.email from auth.users u where u.id = target), null
  );
end;
$$;


ALTER FUNCTION "public"."log_unban"("target" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."maintenance_status"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select jsonb_build_object(
    'is_on', m.is_on,
    'message', m.message,
    'started_at', m.started_at,
    'planned_at', case when not m.is_on and m.planned_at > now() then m.planned_at end,
    'announcements_key', (
      select md5(string_agg(a.id::text || a.updated_at::text, ',' order by a.id))
      from public.announcements a
      where public.announcement_is_live(a)
    )
  )
  from public.maintenance m;
$$;


ALTER FUNCTION "public"."maintenance_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."manila_today"() RETURNS "date"
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select (now() at time zone 'Asia/Manila')::date;
$$;


ALTER FUNCTION "public"."manila_today"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_announcements"() RETURNS TABLE("id" "uuid", "show_modal" boolean, "modal_text" "text", "modal_attachment" "jsonb", "modal_close_after" integer, "show_bar" boolean, "bar_html" "text", "bar_close_after" integer, "repeat" "text", "pages" "text"[], "created_at" timestamp with time zone, "modal_size" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  with mine as (
    select
      a.*,
      a.show_modal and not exists (
        select 1 from public.announcement_dismissals d
        where d.announcement_id = a.id and d.user_id = (select auth.uid()) and d.part = 'modal'
          and (a.repeat = 'once'
            or (a.repeat = 'daily' and (d.closed_at at time zone 'Asia/Manila')::date = public.manila_today()))
      ) as modal_open,
      a.show_bar and not exists (
        select 1 from public.announcement_dismissals d
        where d.announcement_id = a.id and d.user_id = (select auth.uid()) and d.part = 'bar'
          and (a.repeat = 'once'
            or (a.repeat = 'daily' and (d.closed_at at time zone 'Asia/Manila')::date = public.manila_today()))
      ) as bar_open
    from public.announcements a
    where public.announcement_is_live(a) and public.announcement_matches(a, (select auth.uid()))
  )
  select
    m.id, m.modal_open, case when m.modal_open then m.modal_text else '' end, case when m.modal_open then m.modal_attachment end, m.modal_close_after,
    m.bar_open, case when m.bar_open then m.bar_html else '' end, m.bar_close_after,
    m.repeat, m.pages, m.created_at, m.modal_size
  from mine m
  where m.modal_open or m.bar_open
  order by m.created_at desc, m.id;
$$;


ALTER FUNCTION "public"."my_announcements"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_open_review"("target_id" "text") RETURNS "public"."presentation_reviews"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  review public.presentation_reviews;
begin
  select * into review from public.presentation_reviews r where r.presentation_id = target_id for update;
  if not found or review.reviewer_id is distinct from auth.uid() or review.status is distinct from 'reviewing'
    or not public.is_editor() or public.is_banned() then
    raise exception 'You can''t change this review right now.' using errcode = 'QMRVW';
  end if;
  return review;
end;
$$;


ALTER FUNCTION "public"."my_open_review"("target_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_paused_features"() RETURNS TABLE("feature" "text", "paused_until" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select r.feature, r.paused_until
  from public.click_rate r
  where r.user_id = (select auth.uid()) and r.paused_until > now();
$$;


ALTER FUNCTION "public"."my_paused_features"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_profile_photo"() RETURNS TABLE("src" "text", "left_today" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select
    coalesce(p.src, ''),
    -- Same limit as PROFILE_PHOTO_CHANGES_PER_DAY in src/lib/constants.ts.
    3 - case when p.day = (now() at time zone 'Asia/Manila')::date then p.changes else 0 end
  from public.editors e
  left join public.profile_photos p on p.user_id = e.user_id
  where e.user_id = (select auth.uid());
$$;


ALTER FUNCTION "public"."my_profile_photo"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_reviews"() RETURNS TABLE("presentation_id" "text", "title" "text", "status" "text", "admin_note" "text", "canceled_by_admin" boolean, "is_author_update" boolean, "started_at" timestamp with time zone, "submitted_at" timestamp with time zone, "ended_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select r.presentation_id, p.title, r.status, r.admin_note, r.canceled_by_admin, r.is_author_update, r.started_at,
    r.submitted_at, r.ended_at
  from public.presentation_reviews r
  join public.presentations p on p.id = r.presentation_id
  where r.reviewer_id = (select auth.uid())
    and (
      r.status in ('reviewing', 'submitted', 'canceled')
      or (r.status = 'published' and r.is_author_update and p.is_published and p.hidden_at is null)
    )
  order by r.status = 'published', coalesce(r.ended_at, r.started_at) desc;
$$;


ALTER FUNCTION "public"."my_reviews"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_submissions"() RETURNS TABLE("id" "uuid", "presentation_id" "text", "title" "text", "status" "text", "admin_note" "text", "submitted_at" timestamp with time zone, "copy_id" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select s.id, s.presentation_id, coalesce(p.title, c.title, s.title), s.status, s.admin_note, s.submitted_at, s.copy_id
  from public.presentation_submissions s
  left join public.presentations p on p.id = s.presentation_id
  left join public.presentations c on c.id = s.copy_id
  -- With both gone there's nothing to open, so it isn't shown.
  where s.submitter_id = (select auth.uid()) and (s.presentation_id is not null or s.copy_id is not null)
  order by s.submitted_at desc;
$$;


ALTER FUNCTION "public"."my_submissions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."photo_waiting_for_approval"("target_src" "text", "owner" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.slide_photos sp
    join public.presentation_submissions s on s.presentation_id = sp.presentation_id
    where sp.src = target_src and s.status = 'submitted' and (owner is null or s.submitter_id = owner)
  ) or exists (
    select 1
    from public.presentation_reviews r
    where r.status = 'submitted' and r.draft is not null and (owner is null or r.reviewer_id = owner)
      and target_src = any(public.slide_photo_srcs(r.draft))
  );
$$;


ALTER FUNCTION "public"."photo_waiting_for_approval"("target_src" "text", "owner" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."profile_is_visible"("profile_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (select 1 from auth.users u where u.id = profile_id)
    and (
      not exists (select 1 from public.admins a where a.user_id = profile_id)
      or profile_id = (select auth.uid())
      or (select public.is_admin())
    );
$$;


ALTER FUNCTION "public"."profile_is_visible"("profile_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."profile_slug"("name" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select trim(both '-' from regexp_replace(lower(normalize(coalesce(name, ''), NFD)), '[^a-z0-9]+', '-', 'g'));
$$;


ALTER FUNCTION "public"."profile_slug"("name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."publish_photos_of_live_presentation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  perform public.publish_waiting_photos(new.id);
  return null;
end;
$$;


ALTER FUNCTION "public"."publish_photos_of_live_presentation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."publish_photos_of_new_slide"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  update public.shared_photos sp set is_public = true
  where sp.src = new.src
    and not sp.is_public
    and exists (
      select 1 from public.presentations p
      where p.id = new.presentation_id and p.from_admin and p.is_published and p.hidden_at is null
    );
  return null;
end;
$$;


ALTER FUNCTION "public"."publish_photos_of_new_slide"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."publish_review"("target_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  review public.presentation_reviews;
  d jsonb;
  f jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins can publish reviews.' using errcode = '42501';
  end if;
  select * into review from public.presentation_reviews r where r.presentation_id = target_id for update;
  if not found or review.status is distinct from 'submitted' or review.reviewer_id is null then
    raise exception 'This review isn''t waiting to be published.' using errcode = 'QMRVW';
  end if;
  if exists (select 1 from public.banned_users b where b.user_id = review.reviewer_id) then
    raise exception 'This reviewer is banned, so their review can''t be published.' using errcode = 'QMBRV';
  end if;
  d := review.draft;
  f := review.submitted_fields;

  -- Lets the lock triggers through for these changes only (until this transaction ends).
  perform set_config('quizmatter.publishing_review', 'yes', true);

  update public.presentations p set
    title = d ->> 'title',
    description = d ->> 'description',
    grades = public.grades_from(d),
    subject = d ->> 'subject',
    -- A draft saved before Term existed has none: keep it empty.
    term = coalesce(d ->> 'term', ''),
    -- A draft saved before Week and Day existed has none: keep them empty.
    week = coalesce(d ->> 'week', ''),
    day = coalesce(d ->> 'day', ''),
    curriculum = d ->> 'curriculum',
    learning_competency = d ->> 'learningCompetency',
    reference_links = array(select jsonb_array_elements_text(d -> 'referenceLinks')),
    tags = array(select jsonb_array_elements_text(coalesce(d -> 'tags', '[]'))),
    transition = coalesce(d ->> 'transition', 'slide'),
    transition_speed = coalesce((d ->> 'transitionSpeed')::smallint, 3),
    -- The draft becomes the presentation, so its version does too.
    data_version = greatest(p.data_version, review.draft_version),
    updated_at = now()
  where p.id = target_id;

  delete from public.slides s
  where s.presentation_id = target_id
    and s.id not in (select slide ->> 'id' from jsonb_array_elements(d -> 'slides') as slide);

  insert into public.slides (presentation_id, id, position, data)
  select target_id, slide ->> 'id', (ord - 1)::int, slide
  from jsonb_array_elements(d -> 'slides') with ordinality as t(slide, ord)
  on conflict (presentation_id, id) do update set position = excluded.position, data = excluded.data;

  perform set_config('quizmatter.publishing_review', '', true);

  -- The lesson's own editor updating it isn't a reviewer: no "Reviewed by" row, and other editors' access stays as
  -- it was (no last_reviewer_id change).
  if not review.is_author_update then
  insert into public.presentation_reviewers (
    presentation_id, reviewer_id, name, email, reviewed_on, approved_by, approved_at
  )
  values (
    target_id, review.reviewer_id, f ->> 'name', f ->> 'email', (f ->> 'reviewedOn')::date,
    auth.uid(), now()
  )
  on conflict (presentation_id, reviewer_id) do update set
    name = excluded.name,
    email = excluded.email,
    reviewed_on = excluded.reviewed_on,
    approved_by = excluded.approved_by,
    approved_at = excluded.approved_at;
  end if;

  update public.presentation_reviews set
    status = 'published',
    ended_at = now(),
    last_reviewer_id = case when review.is_author_update then last_reviewer_id else review.reviewer_id end,
    draft = null,
    draft_updated_at = null,
    draft_version = 0,
    submitted_fields = null,
    admin_note = null
  where presentation_id = target_id;
end;
$$;


ALTER FUNCTION "public"."publish_review"("target_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."publish_waiting_photos"("target_presentation" "text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  update public.shared_photos set is_public = true
  where not is_public
    and src in (select sp.src from public.slide_photos sp where sp.presentation_id = target_presentation)
    and exists (
      select 1 from public.presentations p
      where p.id = target_presentation and p.from_admin and p.is_published and p.hidden_at is null
    );
$$;


ALTER FUNCTION "public"."publish_waiting_photos"("target_presentation" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."publisher_names"("owner_ids" "uuid"[]) RETURNS TABLE("user_id" "uuid", "display_name" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select names.user_id, names.display_name
  from (
    select o.id as user_id,
      case
        when a.user_id is not null and not (select public.is_admin()) then 'QuizMatter'
        when coalesce(s.display_name, '') = '' then coalesce(u.email, '')
        else s.display_name || coalesce(' (' || u.email || ')', '')
      end as display_name
    from unnest(owner_ids) as o (id)
    left join public.admins a on a.user_id = o.id
    left join public.user_settings s on s.user_id = o.id
    left join auth.users u on u.id = o.id
  ) names
  where names.display_name <> ''
    and exists (select 1 from public.presentations p where p.owner_id = names.user_id and p.is_published);
$$;


ALTER FUNCTION "public"."publisher_names"("owner_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."random_name_ending"() RETURNS "text"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  chars constant text := 'abcdefghijkmnpqrstuvwxyz23456789';
  ending text;
begin
  loop
    ending := '';
    for i in 1..8 loop
      ending := ending || substr(chars, 1 + floor(random() * length(chars))::int, 1);
    end loop;
    if ending ~ '[a-z]' and ending ~ '[0-9]' then
      return ending;
    end if;
  end loop;
end;
$$;


ALTER FUNCTION "public"."random_name_ending"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_activity_event"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  insert into public.activity_events (kind) values (tg_argv[0]);
  return new;
end;
$$;


ALTER FUNCTION "public"."record_activity_event"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recount_announcement"("target" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.announcements where id = target) then
    raise exception 'This announcement was deleted.' using errcode = 'P0002';
  end if;
  perform public.count_announcement(target);
end;
$$;


ALTER FUNCTION "public"."recount_announcement"("target" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refuse_banned_write"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if current_user = 'authenticated' and public.is_banned() then
    raise exception 'This account is banned.' using errcode = 'QMBAN';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."refuse_banned_write"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refuse_locked_photo_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  -- "My photos" (photos): only the person removing it. The shared library (shared_photos, no user_id): anyone's.
  owner uuid := case when tg_table_name = 'photos' then (to_jsonb(old) ->> 'user_id')::uuid end;
begin
  if auth.uid() is not null and public.photo_waiting_for_approval(old.src, owner) then
    raise exception 'This photo is in a presentation waiting for QuizMatter, so it can''t be removed yet.'
      using errcode = 'QMPHL';
  end if;
  return old;
end;
$$;


ALTER FUNCTION "public"."refuse_locked_photo_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_copy_of_quizmatter_presentation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  delete from public.presentations p where p.shared_from = new.id;
  return null;
end;
$$;


ALTER FUNCTION "public"."remove_copy_of_quizmatter_presentation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_new_editor_copies"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  delete from public.presentations p where p.owner_id = new.user_id and p.shared_from is not null;
  return null;
end;
$$;


ALTER FUNCTION "public"."remove_new_editor_copies"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_profile_photo"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if auth.uid() is null then
    raise exception 'Not logged in.' using errcode = '42501';
  end if;
  update public.profile_photos p set src = '', updated_at = now() where p.user_id = auth.uid();
end;
$$;


ALTER FUNCTION "public"."remove_profile_photo"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."review_status"("target_id" "text") RETURNS TABLE("status" "text", "reviewer_name" "text", "is_locked" boolean, "is_mine" boolean, "can_start" boolean, "is_author_update" boolean, "is_author" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select
    r.status,
    coalesce(nullif(s.display_name, ''), 'An editor'),
    coalesce(r.status in ('reviewing', 'submitted') and r.reviewer_id is not null, false),
    coalesce(r.status in ('reviewing', 'submitted') and r.reviewer_id = (select auth.uid()), false),
    coalesce(
      public.is_editor()
        and not public.is_banned()
        and p.from_admin and p.is_published and p.hidden_at is null
        and not public.is_review_locked(p.id)
        and (r.last_reviewer_id is null or r.open_to_all or public.lesson_editor(p.id) = (select auth.uid())),
      false
    ),
    coalesce(r.is_author_update, false),
    coalesce(public.lesson_editor(p.id) = (select auth.uid()), false)
  from public.presentations p
  left join public.presentation_reviews r on r.presentation_id = p.id
  left join public.user_settings s on s.user_id = r.reviewer_id
  where p.id = target_id
    and (p.owner_id = (select auth.uid()) or public.is_admin() or (p.is_published and p.hidden_at is null));
$$;


ALTER FUNCTION "public"."review_status"("target_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_announcement"("a" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  r public.announcements := jsonb_populate_record(null::public.announcements, a);
  saved_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;

  if r.id is null then
    insert into public.announcements (
      name, is_on, starts_at, ends_at, show_modal, modal_text, modal_attachment, modal_close_after, show_bar, bar_html,
      bar_close_after, repeat, pages, genders, age_min, age_max, provinces, town_words, education_levels,
      field_words, presentations_min, presentations_max, roles, modal_size, created_by, created_at, updated_at
    ) values (
      btrim(r.name), r.is_on, r.starts_at, r.ends_at, r.show_modal, coalesce(r.modal_text, ''), r.modal_attachment, r.modal_close_after, r.show_bar,
      r.bar_html, r.bar_close_after, r.repeat, r.pages, r.genders, r.age_min, r.age_max, r.provinces, r.town_words,
      r.education_levels, r.field_words, r.presentations_min, r.presentations_max, r.roles, coalesce(r.modal_size, 'large'), auth.uid(), now(),
      clock_timestamp()
    )
    returning id into saved_id;
  else
    update public.announcements x set
      name = btrim(r.name), is_on = r.is_on, starts_at = r.starts_at, ends_at = r.ends_at,
      show_modal = r.show_modal, modal_text = coalesce(r.modal_text, ''), modal_attachment = r.modal_attachment, modal_close_after = r.modal_close_after,
      show_bar = r.show_bar, bar_html = r.bar_html, bar_close_after = r.bar_close_after, repeat = r.repeat,
      pages = r.pages, genders = r.genders, age_min = r.age_min, age_max = r.age_max, provinces = r.provinces,
      town_words = r.town_words, education_levels = r.education_levels, field_words = r.field_words,
      presentations_min = r.presentations_min, presentations_max = r.presentations_max, roles = r.roles,
      modal_size = coalesce(r.modal_size, 'large'), updated_at = clock_timestamp(),
      -- Ending later again after its cleanup: its closed rows start over (they were deleted).
      closed_cleared_at = case when r.ends_at is null or r.ends_at > now() then null else x.closed_cleared_at end
    where x.id = r.id
    returning x.id into saved_id;
    if saved_id is null then
      raise exception 'This announcement was deleted.' using errcode = 'P0002';
    end if;
  end if;

  perform public.check_announcement_limit();
  perform public.log_admin_action('announcement_saved', 'announcement', saved_id::text, btrim(r.name), null);
  return saved_id;
end;
$$;


ALTER FUNCTION "public"."save_announcement"("a" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_presentation"("presentation" "jsonb", "slide_ids" "text"[], "base_updated_at" bigint, "app_version" integer DEFAULT 0) RETURNS bigint
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  target_id text := presentation ->> 'id';
  saved_updated_at timestamptz;
  saved_version int;
  slide_count int := coalesce(cardinality(slide_ids), 0);
begin
  -- Same as MAX_SLIDES in src/lib/schema.ts. Every presentation has at least one slide.
  if slide_count = 0 or slide_count > 100 then
    raise exception 'A presentation needs 1 to 100 slides.' using errcode = '22023';
  end if;
  if (select count(distinct id) from unnest(slide_ids) as id) <> slide_count then
    raise exception 'A slide id is used twice.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(presentation -> 'slides') as slide where not (slide ->> 'id' = any (slide_ids))
  ) then
    raise exception 'A sent slide is missing from slide_ids.' using errcode = '22023';
  end if;
  -- Only an old app tab sends a teacher's presentation as published (today's app publishes with share_presentation).
  if not coalesce((presentation ->> 'fromAdmin')::boolean, false) and coalesce((presentation ->> 'isPublished')::boolean, false) then
    raise exception 'Reload the page to publish: publishing makes a shared copy now.' using errcode = '42501';
  end if;

  -- Locked until the save ends, so two saves of the same presentation can't cross.
  select p.updated_at, p.data_version into saved_updated_at, saved_version
  from public.presentations p where p.id = target_id for update;
  -- Checked before the conflict below, so an old tab always gets this one (the app keeps its work).
  if found and coalesce(app_version, 0) < saved_version then
    raise exception 'QuizMatter was updated. Reload the page.' using errcode = 'QMOLD';
  end if;
  if found and (base_updated_at is null or floor(extract(epoch from saved_updated_at) * 1000)::bigint <> base_updated_at) then
    raise exception 'This presentation was saved somewhere else since it was opened.' using errcode = 'QM409';
  end if;
  -- A new presentation copied from one that newer app code saved (Make a copy in an old tab): the copy would lose
  -- the fields this tab doesn't know. Only a source the saver can read counts (this runs as the saver), the same
  -- as keep_copied_from.
  if not found and exists (
    select 1 from public.presentations src
    where src.id = nullif(presentation ->> 'copiedFrom', '') and src.data_version > coalesce(app_version, 0)
  ) then
    raise exception 'QuizMatter was updated. Reload the page.' using errcode = 'QMOLD';
  end if;

  insert into public.presentations (
    id, title, description, grades, subject, term, week, day, curriculum, learning_competency, author, reference_links, tags, transition,
    transition_speed, is_published, from_admin, created_at, updated_at, copied_from, data_version
  )
  values (
    target_id,
    presentation ->> 'title',
    presentation ->> 'description',
    public.grades_from(presentation),
    presentation ->> 'subject',
    -- An app tab opened before Term existed sends none: keep it empty.
    coalesce(presentation ->> 'term', ''),
    -- An app tab opened before Week and Day existed sends none: keep them empty.
    coalesce(presentation ->> 'week', ''),
    coalesce(presentation ->> 'day', ''),
    presentation ->> 'curriculum',
    presentation ->> 'learningCompetency',
    presentation ->> 'author',
    array(select jsonb_array_elements_text(presentation -> 'referenceLinks')),
    -- An app tab opened before tags existed sends none: keep it empty.
    array(select jsonb_array_elements_text(coalesce(presentation -> 'tags', '[]'))),
    -- An app tab opened before slide effects existed sends none: use the default.
    coalesce(presentation ->> 'transition', 'slide'),
    -- An app tab opened before effect speeds existed sends none: use the default.
    coalesce((presentation ->> 'transitionSpeed')::smallint, 3),
    -- A teacher's original is never published itself (its shared copy is).
    coalesce((presentation ->> 'fromAdmin')::boolean, false) and (presentation ->> 'isPublished')::boolean,
    coalesce((presentation ->> 'fromAdmin')::boolean, false),
    to_timestamp((presentation ->> 'createdAt')::bigint / 1000.0),
    now(),
    -- Make a copy sends where it was copied from (only on the first save; later saves never change it, see
    -- keep_copied_from). A teacher's other saves send none.
    nullif(presentation ->> 'copiedFrom', ''),
    coalesce(app_version, 0)
  )
  on conflict (id) do update set
    title = excluded.title,
    description = excluded.description,
    grades = excluded.grades,
    subject = excluded.subject,
    term = excluded.term,
    week = excluded.week,
    day = excluded.day,
    curriculum = excluded.curriculum,
    learning_competency = excluded.learning_competency,
    author = excluded.author,
    reference_links = excluded.reference_links,
    tags = excluded.tags,
    transition = excluded.transition,
    transition_speed = excluded.transition_speed,
    -- from_admin isn't changed by a save, so the saved row says which kind it is.
    is_published = public.presentations.from_admin and (presentation ->> 'isPublished')::boolean,
    data_version = greatest(public.presentations.data_version, excluded.data_version),
    updated_at = now();

  delete from public.slides s where s.presentation_id = target_id and not (s.id = any (slide_ids));

  -- Unchanged slides: only their position, and only if it moved.
  update public.slides s set position = (t.ord - 1)::int
  from unnest(slide_ids) with ordinality as t(id, ord)
  where s.presentation_id = target_id and s.id = t.id and s.position <> t.ord - 1;

  insert into public.slides (presentation_id, id, position, data)
  select target_id, slide ->> 'id', array_position(slide_ids, slide ->> 'id') - 1, slide
  from jsonb_array_elements(presentation -> 'slides') as slide
  on conflict (presentation_id, id) do update set position = excluded.position, data = excluded.data;

  -- Every slide in the list must now be in the database. If one isn't (the app thought it was saved, but it
  -- isn't), nothing is saved and the app sends every slide instead.
  if (select count(*) from public.slides s where s.presentation_id = target_id) <> slide_count then
    raise exception 'Some slides are missing. Send every slide.' using errcode = 'QM422';
  end if;

  return floor(extract(epoch from now()) * 1000)::bigint;
end;
$$;


ALTER FUNCTION "public"."save_presentation"("presentation" "jsonb", "slide_ids" "text"[], "base_updated_at" bigint, "app_version" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_review_draft"("target_id" "text", "review_draft" "jsonb", "base_updated_at" bigint, "app_version" integer DEFAULT 0) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  review public.presentation_reviews := public.my_open_review(target_id);
begin
  perform public.check_review_version(review, app_version);
  if review.draft_updated_at is not null
    and (base_updated_at is null or floor(extract(epoch from review.draft_updated_at) * 1000)::bigint <> base_updated_at) then
    raise exception 'This draft was saved somewhere else since it was opened.' using errcode = 'QM409';
  end if;
  perform public.check_review_draft(target_id, review_draft);

  update public.presentation_reviews set
    draft = review_draft,
    draft_updated_at = now(),
    draft_version = greatest(draft_version, coalesce(app_version, 0))
  where presentation_id = target_id;
  return floor(extract(epoch from now()) * 1000)::bigint;
end;
$$;


ALTER FUNCTION "public"."save_review_draft"("target_id" "text", "review_draft" "jsonb", "base_updated_at" bigint, "app_version" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_shared_photos"("query" "text") RETURNS TABLE("src" "text", "width" integer, "height" integer, "file_name" "text", "category" "text", "description" "text", "tags" "text"[], "source" "text")
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  select sp.src, sp.width, sp.height, sp.file_name, c.name, sp.description, sp.tags, sp.source
  from public.shared_photos sp
  join public.photo_categories c on c.id = sp.category_id
  cross join lateral (
    -- Split into words (letters and digits only, so % and _ can't act as wildcards).
    select count(*) as hits
    from unnest(regexp_split_to_array(lower(query), '[^[:alnum:]]+')) as w (word)
    where w.word <> ''
      and (
        lower(sp.description) like '%' || w.word || '%'
        or lower(sp.file_name) like '%' || w.word || '%'
        or lower(c.name) like '%' || w.word || '%'
        or exists (select 1 from unnest(sp.tags) as t (tag) where lower(t.tag) like '%' || w.word || '%')
      )
  ) as m
  where sp.is_public and (m.hits > 0 or trim(query) = '')
  order by m.hits desc, case when trim(query) = '' then sp.created_at end desc nulls last, random()
  limit 20;
$$;


ALTER FUNCTION "public"."search_shared_photos"("query" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."send_back_review"("target_id" "text", "note" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can send reviews back.' using errcode = '42501';
  end if;
  if char_length(trim(note)) not between 1 and 500 then
    raise exception 'The note must be 1 to 500 characters.' using errcode = '22023';
  end if;
  update public.presentation_reviews set status = 'reviewing', admin_note = trim(note), submitted_at = null
  where presentation_id = target_id and status = 'submitted';
  if not found then
    raise exception 'This review isn''t waiting to be published.' using errcode = 'QMRVW';
  end if;
end;
$$;


ALTER FUNCTION "public"."send_back_review"("target_id" "text", "note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."send_back_submission"("target_id" "text", "note" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can send submissions back.' using errcode = '42501';
  end if;
  -- Same limits as reviewNoteSchema in src/lib/schema.ts.
  if char_length(trim(coalesce(note, ''))) not between 1 and 500 then
    raise exception 'The note isn''t valid.' using errcode = '22023';
  end if;
  update public.presentation_submissions set
    status = 'sent_back',
    admin_note = trim(note),
    decided_at = now(),
    decided_by = auth.uid()
  where presentation_id = target_id and status = 'submitted';
  if not found then
    raise exception 'This presentation isn''t waiting for QuizMatter anymore.' using errcode = 'QMSUB';
  end if;
end;
$$;


ALTER FUNCTION "public"."send_back_submission"("target_id" "text", "note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_announcement_on"("target" "uuid", "turn_on" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  saved_name text;
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;

  update public.announcements set is_on = turn_on, updated_at = clock_timestamp()
  where id = target
  returning name into saved_name;
  if saved_name is null then
    raise exception 'This announcement was deleted.' using errcode = 'P0002';
  end if;

  perform public.check_announcement_limit();
  perform public.log_admin_action(
    'announcement_saved', 'announcement', target::text, saved_name, jsonb_build_object('is_on', turn_on)
  );
end;
$$;


ALTER FUNCTION "public"."set_announcement_on"("target" "uuid", "turn_on" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_click_history_email"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  new.email := (select u.email from auth.users u where u.id = new.user_id);
  return new;
end;
$$;


ALTER FUNCTION "public"."set_click_history_email"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_display_name"("name" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  me uuid := auth.uid();
  new_name text := trim(coalesce(name, ''));
  current_name text;
  changed_at timestamptz;
  save_counted text;
begin
  if me is null then
    raise exception 'Not logged in.' using errcode = '42501';
  end if;

  perform public.count_click('display_name');

  select s.display_name, s.display_name_changed_at into current_name, changed_at
  from public.user_settings s
  where s.user_id = me;

  -- Nothing to change: no wait starts.
  if new_name = coalesce(current_name, '') then
    return jsonb_build_object('status', 'saved');
  end if;

  if not public.is_super_admin() and changed_at > now() - interval '30 days' then
    return jsonb_build_object(
      'status', 'wait',
      'until', (extract(epoch from changed_at + interval '30 days') * 1000)::bigint
    );
  end if;

  if new_name <> '' and not public.claim_display_name(public.profile_slug(new_name), me) then
    return jsonb_build_object('status', 'taken');
  end if;

  -- Lets the guard below through, for this transaction only.
  perform set_config('qm.set_display_name', 'on', true);
  begin
    insert into public.user_settings as s (user_id, display_name, display_name_changed_at, updated_at)
    values (me, new_name, now(), now())
    on conflict (user_id) do update set
      display_name = excluded.display_name,
      display_name_changed_at = excluded.display_name_changed_at,
      updated_at = excluded.updated_at;
  exception when unique_violation then
    -- Someone took it at the same moment.
    return jsonb_build_object('status', 'taken');
  end;

  -- The new name goes on every presentation linked to me (my own and my QuizMatter lessons), even one under review
  -- (the lock lets this through). updated_at stays, so an open tab's next save doesn't conflict. It isn't a
  -- presentation save: the write counter's "already counted" flag is on for it, then back as it was.
  save_counted := coalesce(current_setting('quizmatter.write_counted', true), '');
  perform set_config('quizmatter.write_counted', 'yes', true);
  perform set_config('quizmatter.renaming_author', 'yes', true);
  update public.presentations p set author = public.editor_author(me) where p.author_id = me;
  perform set_config('quizmatter.renaming_author', '', true);
  perform set_config('quizmatter.write_counted', save_counted, true);

  return jsonb_build_object('status', 'saved');
end;
$$;


ALTER FUNCTION "public"."set_display_name"("name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_editor_author"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not new.from_admin then
    new.author_id := case
      when exists (select 1 from public.editors e where e.user_id = new.owner_id) then new.owner_id
    end;
  end if;
  if new.author_id is not null then
    new.author := coalesce(public.editor_author(new.author_id), new.author);
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."set_editor_author"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_liked"("presentation_id" "text", "is_liked" boolean) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
begin
  -- Only teachers and editors like; admins only see the counts.
  if me is null or public.is_admin() then
    return 'failed';
  end if;
  if public.is_banned() then
    return 'banned';
  end if;
  perform public.count_click('like');
  -- This click may have just banned them (see count_click): nothing changes, and they're told at once.
  if public.is_banned() then
    return 'banned';
  end if;

  if not is_liked then
    delete from public.presentation_likes l where l.user_id = me and l.presentation_id = set_liked.presentation_id;
    return 'done';
  end if;

  -- Only someone else's presentation that they can see (published and not hidden).
  if not exists (
    select 1 from public.presentations p
    where p.id = set_liked.presentation_id and p.is_published and p.hidden_at is null and p.owner_id <> me
  ) then
    return 'failed';
  end if;

  insert into public.presentation_likes (user_id, presentation_id) values (me, set_liked.presentation_id)
  on conflict do nothing;
  return 'done';
end;
$$;


ALTER FUNCTION "public"."set_liked"("presentation_id" "text", "is_liked" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_maintenance"("turn_on" boolean, "note" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the super admin can do this.' using errcode = '42501';
  end if;

  if turn_on then
    update public.maintenance
    set is_on = true, message = btrim(coalesce(note, '')), started_at = now(), started_by = auth.uid(), planned_at = null
    where id;
    alter role authenticator set pgrst.db_pre_request = 'public.check_maintenance';
  else
    update public.maintenance set is_on = false, started_at = null, started_by = null where id;
    alter role authenticator reset pgrst.db_pre_request;
  end if;
  notify pgrst, 'reload config';

  perform public.log_admin_action(
    case when turn_on then 'maintenance_on' else 'maintenance_off' end, 'site', null, 'QuizMatter', null
  );
end;
$$;


ALTER FUNCTION "public"."set_maintenance"("turn_on" boolean, "note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_profile_photo"("src" "text") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  me uuid := auth.uid();
  today date := (now() at time zone 'Asia/Manila')::date;
  photo public.profile_photos;
  used int;
begin
  if me is null then
    raise exception 'Not logged in.' using errcode = '42501';
  end if;
  if public.is_banned() then
    raise exception 'This account is banned.' using errcode = 'QMBAN';
  end if;
  if not public.is_editor() then
    raise exception 'Only editors can add a profile photo.' using errcode = '42501';
  end if;
  if coalesce(set_profile_photo.src, '') !~ '^https://images\.quizmatter\.com/uploads/[0-9a-f]{64}\.(webp|jpg)$' then
    raise exception 'Not one of our photo files.' using errcode = '22023';
  end if;

  -- The row is locked while it's counted, so two tabs saving at once can't both take the last change.
  insert into public.profile_photos (user_id) values (me) on conflict (user_id) do nothing;
  select * into photo from public.profile_photos p where p.user_id = me for update;
  used := case when photo.day = today then photo.changes else 0 end;
  -- Same limit as PROFILE_PHOTO_CHANGES_PER_DAY in src/lib/constants.ts.
  if used >= 3 then
    raise exception 'No profile photo changes left today.' using errcode = 'QMPPL';
  end if;

  update public.profile_photos p
  set src = set_profile_photo.src, day = today, changes = used + 1, updated_at = now()
  where p.user_id = me;
  return 3 - (used + 1);
end;
$_$;


ALTER FUNCTION "public"."set_profile_photo"("src" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_review_open"("target_id" "text", "is_open" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change this.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.presentations p where p.id = target_id and p.from_admin) then
    raise exception 'Only QuizMatter presentations can be reviewed.' using errcode = 'QMRVW';
  end if;
  insert into public.presentation_reviews (presentation_id, open_to_all) values (target_id, is_open)
  on conflict (presentation_id) do update set open_to_all = excluded.open_to_all;
end;
$$;


ALTER FUNCTION "public"."set_review_open"("target_id" "text", "is_open" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_saved"("presentation_id" "text", "is_saved" boolean) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
begin
  if me is null then
    return 'failed';
  end if;
  if public.is_banned() then
    return 'banned';
  end if;
  perform public.count_click('saved');
  -- This click may have just banned them (see count_click): nothing is saved, and they're told at once.
  if public.is_banned() then
    return 'banned';
  end if;

  if not is_saved then
    delete from public.saved_presentations s where s.user_id = me and s.presentation_id = set_saved.presentation_id;
    return 'done';
  end if;

  -- Only someone else's presentation that they can see (published and not hidden).
  if not exists (
    select 1 from public.presentations p
    where p.id = set_saved.presentation_id and p.is_published and p.hidden_at is null and p.owner_id <> me
  ) then
    return 'failed';
  end if;

  -- Two saves from the same teacher at the same moment wait for each other, so both are counted.
  perform pg_advisory_xact_lock(hashtext('saved:' || me::text));
  if exists (select 1 from public.saved_presentations s where s.user_id = me and s.presentation_id = set_saved.presentation_id) then
    return 'done';
  end if;
  -- Same as MAX_SAVED in src/lib/schema.ts.
  if (select count(*) from public.saved_presentations s where s.user_id = me) >= 50 then
    return 'limit';
  end if;

  insert into public.saved_presentations (user_id, presentation_id) values (me, set_saved.presentation_id);
  return 'done';
end;
$$;


ALTER FUNCTION "public"."set_saved"("presentation_id" "text", "is_saved" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."share_editor_photo"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if new.src like '%.webp' and exists (select 1 from public.editors e where e.user_id = new.user_id) then
    begin
      insert into public.shared_photos (src, width, height, category_id, uploaded_by, is_public)
      select new.src, new.width, new.height, c.id, new.user_id, false
      from public.photo_categories c
      where lower(c.name) = 'from editors'
      on conflict (src) do nothing;
    exception when others then
      null;
    end;
  end if;
  return null;
end;
$$;


ALTER FUNCTION "public"."share_editor_photo"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."share_new_editor_photos"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  insert into public.shared_photos (src, width, height, category_id, uploaded_by, is_public)
  select p.src, p.width, p.height, c.id, p.user_id, false
  from public.photos p
  cross join public.photo_categories c
  where p.user_id = new.user_id and p.src like '%.webp' and lower(c.name) = 'from editors'
  on conflict (src) do nothing;

  update public.shared_photos sp set is_public = true
  where not sp.is_public
    and sp.uploaded_by = new.user_id
    and exists (
      select 1
      from public.slide_photos slp
      join public.presentations pr on pr.id = slp.presentation_id
      where slp.src = sp.src and pr.from_admin and pr.is_published and pr.hidden_at is null
    );
  return null;
end;
$$;


ALTER FUNCTION "public"."share_new_editor_photos"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."share_presentation"("target_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  original public.presentations;
  copy_id text;
begin
  select * into original from public.presentations p where p.id = target_id for update;
  if not found or original.owner_id is distinct from auth.uid() or original.from_admin or original.shared_from is not null then
    raise exception 'You can only share your own presentations.' using errcode = '42501';
  end if;
  if public.is_editor() then
    raise exception 'Editors send presentations to QuizMatter instead of publishing them.' using errcode = '42501';
  end if;
  if original.hidden_at is not null then
    raise exception 'QuizMatter hid this presentation, so it can''t be shared.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.presentations p
    where (p.id = original.copied_from or p.shared_from = original.copied_from) and p.hidden_at is not null
  ) then
    raise exception 'QuizMatter hid the presentation this was copied from, so it can''t be shared.' using errcode = '42501';
  end if;
  if public.is_review_locked(target_id) then
    raise exception 'This presentation is waiting for QuizMatter.' using errcode = 'QMREV';
  end if;
  -- Same rule as publishableSchema in src/lib/schema.ts.
  if not public.has_publishable_content(target_id) then
    raise exception 'Add a title and some content before publishing.' using errcode = 'QMPUB';
  end if;

  select p.id into copy_id from public.presentations p where p.shared_from = target_id for update;
  perform public.count_click('share');
  if copy_id is null then
    perform public.count_click('publish');
  end if;

  -- Lets the shared copy triggers through for these changes only (until this transaction ends).
  perform set_config('quizmatter.sharing', 'yes', true);
  if copy_id is null then
    copy_id := gen_random_uuid()::text;
    insert into public.presentations (
      id, owner_id, title, description, grades, subject, term, week, day, curriculum, learning_competency, author,
      reference_links, tags, transition, transition_speed, is_published, from_admin, shared_from, shared_at,
      created_at, updated_at, data_version
    )
    values (
      copy_id, original.owner_id, original.title, original.description, original.grades, original.subject,
      original.term, original.week, original.day, original.curriculum, original.learning_competency, original.author,
      original.reference_links, original.tags, original.transition, original.transition_speed, true, false,
      target_id, now(), now(), now(), original.data_version
    );
  else
    -- Same id, created_at and hidden_at, so links, bookmarks, reports and an admin's hiding stay.
    update public.presentations p set
      title = original.title,
      description = original.description,
      grades = original.grades,
      subject = original.subject,
      term = original.term,
      week = original.week,
      day = original.day,
      curriculum = original.curriculum,
      learning_competency = original.learning_competency,
      author = original.author,
      reference_links = original.reference_links,
      tags = original.tags,
      transition = original.transition,
      transition_speed = original.transition_speed,
      data_version = original.data_version,
      shared_at = now(),
      updated_at = now()
    where p.id = copy_id;
    delete from public.slides s where s.presentation_id = copy_id;
  end if;
  insert into public.slides (presentation_id, id, position, data)
  select copy_id, s.id, s.position, s.data from public.slides s where s.presentation_id = target_id;
  perform set_config('quizmatter.sharing', '', true);

  return jsonb_build_object('id', copy_id, 'sharedAt', floor(extract(epoch from now()) * 1000)::bigint);
end;
$$;


ALTER FUNCTION "public"."share_presentation"("target_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."slide_photo_srcs"("data" "jsonb") RETURNS "text"[]
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select coalesce(array_agg(distinct m[1] order by m[1]), '{}')
  from regexp_matches(data::text, 'https://images\.quizmatter\.com/uploads/[0-9a-f]{64}\.(?:webp|jpg)', 'g') as m;
$$;


ALTER FUNCTION "public"."slide_photo_srcs"("data" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."start_review"("target_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  review public.presentation_reviews;
  -- The lesson's own editor (never true for a lesson an admin made).
  is_author boolean := coalesce(public.lesson_editor(target_id) = auth.uid(), false);
begin
  if not public.is_editor() or public.is_banned() then
    raise exception 'Only editors can review presentations.' using errcode = 'QMRVW';
  end if;
  if not exists (
    select 1 from public.presentations p
    where p.id = target_id and p.from_admin and p.is_published and p.hidden_at is null
  ) then
    raise exception 'Only shared QuizMatter presentations can be reviewed.' using errcode = 'QMRVW';
  end if;

  insert into public.presentation_reviews (presentation_id) values (target_id) on conflict do nothing;
  -- Locked until this ends, so two editors clicking at once can't both start.
  select * into review from public.presentation_reviews r where r.presentation_id = target_id for update;
  -- A round with no reviewer (their account is gone) doesn't count as open.
  if coalesce(review.status in ('reviewing', 'submitted') and review.reviewer_id is not null, false) then
    raise exception 'Someone else is reviewing this presentation.' using errcode = 'QMRVW';
  end if;
  -- Reviewed and published before: only "Open to all editors" lets anyone start again. The author always may.
  if not (is_author or review.last_reviewer_id is null or review.open_to_all) then
    raise exception 'This presentation was already reviewed. QuizMatter has to open it for review again.'
      using errcode = 'QMRVW';
  end if;

  update public.presentation_reviews set
    reviewer_id = auth.uid(),
    status = 'reviewing',
    draft = null,
    draft_updated_at = null,
    submitted_fields = null,
    admin_note = null,
    started_at = now(),
    submitted_at = null,
    -- A new round: not submitted yet.
    first_submitted_at = null,
    ended_at = null,
    canceled_by_admin = false,
    is_author_update = is_author,
    -- The author's update leaves "Open to all editors" as it was.
    open_to_all = case when is_author then open_to_all else false end
  where presentation_id = target_id;
end;
$$;


ALTER FUNCTION "public"."start_review"("target_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."stop_review"("target_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not exists (
    select 1 from public.presentation_reviews r
    where r.presentation_id = target_id and r.reviewer_id = auth.uid() and r.status in ('reviewing', 'submitted')
  ) then
    raise exception 'You can''t stop this review.' using errcode = 'QMRVW';
  end if;
  perform public.cancel_review(target_id, false);
end;
$$;


ALTER FUNCTION "public"."stop_review"("target_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."strip_sign_up_details"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.raw_user_meta_data is not null then
    new.raw_user_meta_data := new.raw_user_meta_data - array['first_name', 'last_name', 'contact_number',
      'education_level', 'education_field', 'display_name', 'terms_version', 'birth_date', 'gender', 'province',
      'town'];
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."strip_sign_up_details"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submission_status"("target_id" "text") RETURNS TABLE("status" "text", "admin_note" "text", "submitted_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select s.status, s.admin_note, s.submitted_at
  from public.presentation_submissions s
  where s.presentation_id = target_id and (s.submitter_id = (select auth.uid()) or public.is_admin());
$$;


ALTER FUNCTION "public"."submission_status"("target_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_presentation"("target_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  p public.presentations;
  existing public.presentation_submissions;
begin
  if not public.is_editor() or public.is_banned() then
    raise exception 'Only editors can submit presentations to QuizMatter.' using errcode = '42501';
  end if;
  select * into p from public.presentations pr where pr.id = target_id and pr.owner_id = auth.uid() for update;
  if not found or p.from_admin or p.hidden_at is not null then
    raise exception 'This presentation can''t be submitted.' using errcode = 'QMSUB';
  end if;
  -- An open review round locks it too (only QuizMatter presentations have those, so this is a safety net).
  if public.is_review_locked(target_id) then
    raise exception 'This presentation is locked right now.' using errcode = 'QMSUB';
  end if;
  select * into existing from public.presentation_submissions s where s.presentation_id = target_id for update;
  if found and existing.status in ('submitted', 'approved') then
    raise exception 'This presentation is already waiting or already in QuizMatter.' using errcode = 'QMSUB';
  end if;
  if not public.has_publishable_content(target_id) then
    raise exception 'Add a title and some content before publishing.' using errcode = 'QMPUB';
  end if;

  insert into public.presentation_submissions (presentation_id, submitter_id, status, title, submitted_at)
  values (target_id, auth.uid(), 'submitted', p.title, now())
  on conflict (presentation_id) do update set
    submitter_id = excluded.submitter_id,
    status = 'submitted',
    title = excluded.title,
    admin_note = null,
    submitted_at = now(),
    decided_at = null,
    decided_by = null;
end;
$$;


ALTER FUNCTION "public"."submit_presentation"("target_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_review"("target_id" "text", "review_draft" "jsonb", "reviewed_on" "date", "base_updated_at" bigint, "app_version" integer DEFAULT 0) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  review public.presentation_reviews := public.my_open_review(target_id);
  reviewer_email text;
  reviewer_name text;
begin
  perform public.check_review_version(review, app_version);
  if review.draft_updated_at is not null
    and (base_updated_at is null or floor(extract(epoch from review.draft_updated_at) * 1000)::bigint <> base_updated_at) then
    raise exception 'This draft was saved somewhere else since it was opened.' using errcode = 'QM409';
  end if;
  perform public.check_review_draft(target_id, review_draft);
  -- The reviewer's "today": one day either side of the server's, for time zones ahead of or behind UTC.
  if reviewed_on is null or reviewed_on not between current_date - 1 and current_date + 1 then
    raise exception 'The review date isn''t valid.' using errcode = '22023';
  end if;

  select u.email into reviewer_email from auth.users u where u.id = auth.uid();
  if coalesce(reviewer_email, '') = '' then
    raise exception 'Your account has no email.' using errcode = '22023';
  end if;
  select coalesce(nullif(trim(s.display_name), ''), split_part(reviewer_email, '@', 1)) into reviewer_name
  from (select 1) as one
  left join public.user_settings s on s.user_id = auth.uid();

  update public.presentation_reviews set
    draft = review_draft,
    draft_updated_at = now(),
    draft_version = greatest(draft_version, coalesce(app_version, 0)),
    submitted_fields = jsonb_build_object(
      'name', left(reviewer_name, 100),
      'email', reviewer_email,
      'reviewedOn', reviewed_on
    ),
    status = 'submitted',
    submitted_at = now(),
    -- Only the round's first submit: submitting again after a send-back keeps it.
    first_submitted_at = coalesce(first_submitted_at, now()),
    admin_note = null
  where presentation_id = target_id;
end;
$$;


ALTER FUNCTION "public"."submit_review"("target_id" "text", "review_draft" "jsonb", "reviewed_on" "date", "base_updated_at" bigint, "app_version" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_slide_photos"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  new_srcs text[] := public.slide_photo_srcs(new.data);
  old_srcs text[];
begin
  select coalesce(array_agg(sp.src order by sp.src), '{}') into old_srcs
  from public.slide_photos sp
  where sp.presentation_id = new.presentation_id and sp.slide_id = new.id;

  -- Same photos as before (e.g. only the words changed): nothing to write.
  if new_srcs = old_srcs then
    return null;
  end if;

  delete from public.slide_photos sp where sp.presentation_id = new.presentation_id and sp.slide_id = new.id;
  insert into public.slide_photos (presentation_id, slide_id, src)
  select new.presentation_id, new.id, unnest(new_srcs);
  return null;
end;
$$;


ALTER FUNCTION "public"."sync_slide_photos"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tags_text"("tags" "text"[]) RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$ select array_to_string(tags, ' ') $$;


ALTER FUNCTION "public"."tags_text"("tags" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."teacher_profile"("slug" "text") RETURNS TABLE("display_name" "text", "first_name" "text", "last_name" "text", "education_level" "text", "education_field" "text", "bio" "text", "photo_src" "text", "full_name_public" boolean, "education_public" boolean, "bio_public" boolean, "town" "text", "province" "text", "town_public" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select
    s.display_name,
    case when v.full_name or v.mine then coalesce(s.first_name, '') else '' end,
    case when v.full_name or v.mine then coalesce(s.last_name, '') else '' end,
    case when v.education or v.mine then coalesce(s.education_level, '') else '' end,
    case when v.education or v.mine then coalesce(s.education_field, '') else '' end,
    case when v.bio or v.mine then coalesce(s.bio, '') else '' end,
    coalesce(pp.src, ''),
    v.full_name,
    v.education,
    v.bio,
    case when v.town or v.mine then s.town else '' end,
    case when v.town or v.mine then s.province else '' end,
    v.town
  from public.user_settings s
  left join public.profile_photos pp on pp.user_id = s.user_id
  cross join lateral (
    select
      s.full_name_public or e.is_editor as full_name,
      s.education_public or e.is_editor as education,
      s.bio_public or e.is_editor as bio,
      s.town_public or e.is_editor as town,
      s.user_id = (select auth.uid()) as mine
    from (select exists (select 1 from public.editors ed where ed.user_id = s.user_id) as is_editor) e
  ) v
  where teacher_profile.slug <> ''
    and s.profile_slug = teacher_profile.slug
    and public.profile_is_visible(s.user_id);
$$;


ALTER FUNCTION "public"."teacher_profile"("slug" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."teacher_shared_presentations"("slug" "text") RETURNS TABLE("id" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  with person as (
    select st.user_id
    from public.user_settings st
    where teacher_shared_presentations.slug <> '' and st.profile_slug = teacher_shared_presentations.slug
      and public.profile_is_visible(st.user_id)
  )
  select p.id
  from person
  join public.presentations p on p.owner_id = person.user_id
  where p.shared_from is not null and p.is_published and p.hidden_at is null and not p.from_admin
  order by p.updated_at desc
  limit 200;
$$;


ALTER FUNCTION "public"."teacher_shared_presentations"("slug" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."unshare_presentation"("target_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not exists (
    select 1 from public.presentations p
    where p.id = target_id and p.owner_id = auth.uid() and not p.from_admin and p.shared_from is null
  ) then
    raise exception 'You can only change your own presentations.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.presentations p where p.shared_from = target_id) then
    return;
  end if;
  perform public.count_click('share');
  delete from public.presentations p where p.shared_from = target_id;
end;
$$;


ALTER FUNCTION "public"."unshare_presentation"("target_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."used_photo_srcs"() RETURNS "text"[]
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select coalesce(array_agg(distinct used.src), '{}')
  from (
    select p.src from public.photos p
    union
    select sp.src from public.shared_photos sp
    union
    select slp.src from public.slide_photos slp
    union
    select unnest(public.slide_photo_srcs(r.draft)) from public.presentation_reviews r where r.draft is not null
    union
    select pp.src from public.profile_photos pp where pp.src <> ''
    union
    select a.modal_attachment ->> 'src' from public.announcements a where a.modal_attachment ? 'src'
  ) as used (src);
$$;


ALTER FUNCTION "public"."used_photo_srcs"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."visible_profiles"("profile_ids" "uuid"[]) RETURNS TABLE("id" "uuid", "slug" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select s.user_id, s.profile_slug
  from public.user_settings s
  where s.user_id = any (profile_ids)
    and s.profile_slug <> ''
    and public.profile_is_visible(s.user_id);
$$;


ALTER FUNCTION "public"."visible_profiles"("profile_ids" "uuid"[]) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."activity_events" (
    "id" bigint NOT NULL,
    "kind" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "activity_events_kind_check" CHECK (("kind" = ANY (ARRAY['like'::"text", 'save'::"text", 'report'::"text"])))
);


ALTER TABLE "public"."activity_events" OWNER TO "postgres";


ALTER TABLE "public"."activity_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."activity_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."admin_actions" (
    "id" bigint NOT NULL,
    "admin_id" "uuid",
    "admin_name" "text" DEFAULT ''::"text" NOT NULL,
    "action" "text" NOT NULL,
    "target_type" "text" NOT NULL,
    "target_id" "text",
    "target_title" "text" DEFAULT ''::"text" NOT NULL,
    "details" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "admin_actions_action_check" CHECK (("action" = ANY (ARRAY['review_published'::"text", 'review_sent_back'::"text", 'review_canceled'::"text", 'review_opened'::"text", 'review_closed'::"text", 'submission_approved'::"text", 'submission_sent_back'::"text", 'presentation_shared'::"text", 'presentation_unshared'::"text", 'presentation_moved'::"text", 'presentation_hidden'::"text", 'presentation_unhidden'::"text", 'reports_dismissed'::"text", 'presentation_deleted'::"text", 'teacher_banned'::"text", 'ban_updated'::"text", 'teacher_unbanned'::"text", 'editor_added'::"text", 'editor_removed'::"text", 'pause_released'::"text", 'category_created'::"text", 'category_renamed'::"text", 'category_deleted'::"text", 'photo_deleted'::"text", 'profile_photo_removed'::"text", 'maintenance_on'::"text", 'maintenance_off'::"text", 'maintenance_announced'::"text", 'announcement_saved'::"text", 'announcement_deleted'::"text"]))),
    CONSTRAINT "admin_actions_target_type_check" CHECK (("target_type" = ANY (ARRAY['presentation'::"text", 'user'::"text", 'category'::"text", 'photo'::"text", 'site'::"text", 'announcement'::"text"])))
);


ALTER TABLE "public"."admin_actions" OWNER TO "postgres";


ALTER TABLE "public"."admin_actions" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."admin_actions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."admins" (
    "user_id" "uuid" NOT NULL,
    "is_super" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."admins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."announcement_dismissals" (
    "announcement_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "part" "text" NOT NULL,
    "closed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "announcement_dismissals_part_check" CHECK (("part" = ANY (ARRAY['modal'::"text", 'bar'::"text"])))
);


ALTER TABLE "public"."announcement_dismissals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."banned_users" (
    "user_id" "uuid" NOT NULL,
    "reason" "text" NOT NULL,
    "banned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_automatic" boolean DEFAULT false NOT NULL,
    CONSTRAINT "banned_users_reason_check" CHECK ((("length"(TRIM(BOTH FROM "reason")) >= 1) AND ("length"(TRIM(BOTH FROM "reason")) <= 200)))
);


ALTER TABLE "public"."banned_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."blocked_email_domains" (
    "domain" "text" NOT NULL,
    CONSTRAINT "blocked_email_domains_domain_check" CHECK ((("domain" <> ''::"text") AND ("domain" = "lower"("btrim"("domain")))))
);


ALTER TABLE "public"."blocked_email_domains" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."click_history" (
    "id" bigint NOT NULL,
    "user_id" "uuid",
    "feature" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "pause_minutes" integer,
    "streak" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "email" "text",
    CONSTRAINT "click_history_kind_check" CHECK (("kind" = ANY (ARRAY['pause'::"text", 'ban'::"text", 'release'::"text"])))
);


ALTER TABLE "public"."click_history" OWNER TO "postgres";


ALTER TABLE "public"."click_history" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."click_history_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."click_limits" (
    "feature" "text" NOT NULL,
    "max_clicks" integer NOT NULL,
    "per_seconds" integer NOT NULL,
    "first_pause_minutes" integer NOT NULL,
    "repeat_pause_minutes" integer NOT NULL,
    "repeat_within_hours" integer NOT NULL,
    "label" "text" DEFAULT ''::"text" NOT NULL,
    "ban_after_pauses" integer,
    "daily_reset_time_zone" "text",
    CONSTRAINT "click_limits_ban_after_pauses_check" CHECK (("ban_after_pauses" > 1)),
    CONSTRAINT "click_limits_first_pause_minutes_check" CHECK (("first_pause_minutes" > 0)),
    CONSTRAINT "click_limits_label_check" CHECK (("length"("label") <= 60)),
    CONSTRAINT "click_limits_max_clicks_check" CHECK (("max_clicks" > 0)),
    CONSTRAINT "click_limits_per_seconds_check" CHECK (("per_seconds" > 0)),
    CONSTRAINT "click_limits_repeat_pause_minutes_check" CHECK (("repeat_pause_minutes" > 0)),
    CONSTRAINT "click_limits_repeat_within_hours_check" CHECK (("repeat_within_hours" > 0))
);


ALTER TABLE "public"."click_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."click_rate" (
    "user_id" "uuid" NOT NULL,
    "feature" "text" NOT NULL,
    "window_start" timestamp with time zone NOT NULL,
    "clicks" integer NOT NULL,
    "paused_until" timestamp with time zone,
    "pause_streak" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."click_rate" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."editors" (
    "user_id" "uuid" NOT NULL,
    "added_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."editors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."folder_items" (
    "presentation_id" "text" NOT NULL,
    "folder_id" "uuid" NOT NULL,
    "owner_id" "uuid" DEFAULT "auth"."uid"() NOT NULL
);


ALTER TABLE "public"."folder_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."folders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "folders_name_check" CHECK ((("name" = "btrim"("name")) AND (("char_length"("name") >= 1) AND ("char_length"("name") <= 60))))
);


ALTER TABLE "public"."folders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."maintenance" (
    "id" boolean DEFAULT true NOT NULL,
    "is_on" boolean DEFAULT false NOT NULL,
    "message" "text" DEFAULT ''::"text" NOT NULL,
    "started_at" timestamp with time zone,
    "started_by" "uuid",
    "planned_at" timestamp with time zone,
    CONSTRAINT "maintenance_id_check" CHECK ("id"),
    CONSTRAINT "maintenance_message_check" CHECK (("char_length"("message") <= 300))
);


ALTER TABLE "public"."maintenance" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."photo_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "photo_categories_name_check" CHECK ((("length"(TRIM(BOTH FROM "name")) >= 1) AND ("length"(TRIM(BOTH FROM "name")) <= 40)))
);


ALTER TABLE "public"."photo_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."photos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "src" "text" NOT NULL,
    "width" integer NOT NULL,
    "height" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "photos_height_check" CHECK (("height" > 0)),
    CONSTRAINT "photos_src_check" CHECK ((("src" ~~ 'https://images.quizmatter.com/uploads/%'::"text") AND ("length"("src") <= 300))),
    CONSTRAINT "photos_width_check" CHECK (("width" > 0))
);


ALTER TABLE "public"."photos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."presentation_like_counts" (
    "presentation_id" "text" NOT NULL,
    "total" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "presentation_like_counts_total_check" CHECK (("total" >= 0))
);


ALTER TABLE "public"."presentation_like_counts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."presentation_likes" (
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "presentation_id" "text" NOT NULL,
    "liked_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."presentation_likes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."presentation_reports" (
    "presentation_id" "text" NOT NULL,
    "reporter_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "reason" "text" NOT NULL,
    "note" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "presentation_reports_note_check" CHECK (("char_length"("note") <= 500)),
    CONSTRAINT "presentation_reports_reason_check" CHECK (("reason" = ANY (ARRAY['unsafe'::"text", 'spam'::"text", 'copied'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."presentation_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."presentation_reviewers" (
    "presentation_id" "text" NOT NULL,
    "reviewer_id" "uuid",
    "name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "reviewed_on" "date" NOT NULL,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    CONSTRAINT "presentation_reviewers_email_check" CHECK ((("char_length"("email") >= 3) AND ("char_length"("email") <= 254))),
    CONSTRAINT "presentation_reviewers_name_check" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 100)))
);


ALTER TABLE "public"."presentation_reviewers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."presentation_submissions" (
    "presentation_id" "text",
    "submitter_id" "uuid",
    "status" "text" NOT NULL,
    "admin_note" "text",
    "submitted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "decided_at" timestamp with time zone,
    "decided_by" "uuid",
    "copy_id" "text",
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" DEFAULT ''::"text" NOT NULL,
    CONSTRAINT "presentation_submissions_admin_note_check" CHECK (("char_length"("admin_note") <= 500)),
    CONSTRAINT "presentation_submissions_status_check" CHECK (("status" = ANY (ARRAY['submitted'::"text", 'sent_back'::"text", 'approved'::"text", 'canceled'::"text"]))),
    CONSTRAINT "presentation_submissions_title_check" CHECK (("char_length"("title") <= 120))
);


ALTER TABLE "public"."presentation_submissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."presentations" (
    "id" "text" NOT NULL,
    "owner_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "title" "text" DEFAULT ''::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "grades" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "subject" "text" DEFAULT ''::"text" NOT NULL,
    "curriculum" "text" DEFAULT ''::"text" NOT NULL,
    "learning_competency" "text" DEFAULT ''::"text" NOT NULL,
    "author" "text" DEFAULT ''::"text" NOT NULL,
    "is_published" boolean DEFAULT false NOT NULL,
    "reference_links" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "from_admin" boolean DEFAULT false NOT NULL,
    "hidden_at" timestamp with time zone,
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "tags_text" "text" GENERATED ALWAYS AS ("public"."tags_text"("tags")) STORED,
    "transition" "text" DEFAULT 'slide'::"text" NOT NULL,
    "transition_speed" smallint DEFAULT 3 NOT NULL,
    "week" "text" DEFAULT ''::"text" NOT NULL,
    "day" "text" DEFAULT ''::"text" NOT NULL,
    "term" "text" DEFAULT ''::"text" NOT NULL,
    "search_text" "text" GENERATED ALWAYS AS (((((((((((((((((COALESCE("title", ''::"text") || ' '::"text") || COALESCE("subject", ''::"text")) || ' '::"text") || COALESCE("term", ''::"text")) || ' '::"text") || COALESCE("week", ''::"text")) || ' '::"text") || COALESCE("day", ''::"text")) || ' '::"text") || COALESCE("curriculum", ''::"text")) || ' '::"text") || COALESCE("learning_competency", ''::"text")) || ' '::"text") || COALESCE("author", ''::"text")) || ' '::"text") || "public"."tags_text"("tags"))) STORED,
    "shared_from" "text",
    "shared_at" timestamp with time zone,
    "copied_from" "text",
    "data_version" integer DEFAULT 0 NOT NULL,
    "author_id" "uuid",
    CONSTRAINT "presentations_day_length" CHECK (("char_length"("day") <= 40)),
    CONSTRAINT "presentations_grades_size" CHECK (("cardinality"("grades") <= 14)),
    CONSTRAINT "presentations_term_length" CHECK (("char_length"("term") <= 40)),
    CONSTRAINT "presentations_transition_check" CHECK (("transition" = ANY (ARRAY['none'::"text", 'fade'::"text", 'slide'::"text", 'zoom'::"text"]))),
    CONSTRAINT "presentations_transition_speed_check" CHECK ((("transition_speed" >= 1) AND ("transition_speed" <= 5))),
    CONSTRAINT "presentations_week_length" CHECK (("char_length"("week") <= 40))
);


ALTER TABLE "public"."presentations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profile_photos" (
    "user_id" "uuid" NOT NULL,
    "src" "text" DEFAULT ''::"text" NOT NULL,
    "day" "date",
    "changes" integer DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."profile_photos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."saved_presentations" (
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "presentation_id" "text" NOT NULL,
    "saved_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."saved_presentations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."shared_photos" (
    "src" "text" NOT NULL,
    "width" integer NOT NULL,
    "height" integer NOT NULL,
    "category_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "file_name" "text" DEFAULT ''::"text" NOT NULL,
    "source" "text" DEFAULT ''::"text" NOT NULL,
    "bytes" integer,
    "uploaded_by" "uuid" DEFAULT "auth"."uid"(),
    "is_public" boolean DEFAULT true NOT NULL,
    CONSTRAINT "shared_photos_bytes_check" CHECK ((("bytes" > 0) AND ("bytes" <= 2097152))),
    CONSTRAINT "shared_photos_description_check" CHECK (("length"("description") <= 300)),
    CONSTRAINT "shared_photos_file_name_check" CHECK (("length"("file_name") <= 200)),
    CONSTRAINT "shared_photos_height_check" CHECK (("height" > 0)),
    CONSTRAINT "shared_photos_source_check" CHECK (("length"("source") <= 300)),
    CONSTRAINT "shared_photos_src_check" CHECK ((("src" ~~ 'https://images.quizmatter.com/uploads/%.webp'::"text") AND ("length"("src") <= 300))),
    CONSTRAINT "shared_photos_tags_check" CHECK (("cardinality"("tags") <= 10)),
    CONSTRAINT "shared_photos_width_check" CHECK (("width" > 0))
);


ALTER TABLE "public"."shared_photos" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."shared_photo_counts" WITH ("security_invoker"='true') AS
 SELECT "category_id",
    ("count"(*))::integer AS "photos",
    ("count"(*) FILTER (WHERE ("description" = ''::"text")))::integer AS "no_description",
    ("count"(*) FILTER (WHERE ("source" = ''::"text")))::integer AS "no_source",
    "uploaded_by",
    ("count"(*) FILTER (WHERE (NOT "is_public")))::integer AS "waiting"
   FROM "public"."shared_photos"
  GROUP BY "category_id", "uploaded_by";


ALTER VIEW "public"."shared_photo_counts" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."shared_photos_search" WITH ("security_invoker"='true') AS
 SELECT "sp"."src",
    "sp"."width",
    "sp"."height",
    "sp"."category_id",
    "sp"."file_name",
    "sp"."description",
    "sp"."tags",
    "sp"."source",
    "sp"."bytes",
    "sp"."created_at",
    "array_to_string"("sp"."tags", ' '::"text") AS "tags_text",
    "c"."name" AS "category_name",
    "sp"."uploaded_by",
    "sp"."is_public"
   FROM ("public"."shared_photos" "sp"
     JOIN "public"."photo_categories" "c" ON (("c"."id" = "sp"."category_id")));


ALTER VIEW "public"."shared_photos_search" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sign_up_attempts" (
    "ip" "inet" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."sign_up_attempts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."slide_photos" (
    "presentation_id" "text" NOT NULL,
    "slide_id" "text" NOT NULL,
    "src" "text" NOT NULL
);


ALTER TABLE "public"."slide_photos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."slides" (
    "presentation_id" "text" NOT NULL,
    "id" "text" NOT NULL,
    "position" integer NOT NULL,
    "data" "jsonb" NOT NULL
);


ALTER TABLE "public"."slides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_settings" (
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "favorite_element_categories" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "display_name" "text" DEFAULT ''::"text" NOT NULL,
    "first_name" "text" DEFAULT ''::"text" NOT NULL,
    "last_name" "text" DEFAULT ''::"text" NOT NULL,
    "contact_number" "text" DEFAULT ''::"text" NOT NULL,
    "education_level" "text" DEFAULT ''::"text" NOT NULL,
    "education_field" "text" DEFAULT ''::"text" NOT NULL,
    "bio" "text" DEFAULT ''::"text" NOT NULL,
    "profile_slug" "text" GENERATED ALWAYS AS ("public"."profile_slug"("display_name")) STORED,
    "display_name_changed_at" timestamp with time zone,
    "full_name_public" boolean DEFAULT true NOT NULL,
    "education_public" boolean DEFAULT true NOT NULL,
    "bio_public" boolean DEFAULT true NOT NULL,
    "terms_version" "text",
    "terms_accepted_at" timestamp with time zone,
    "birth_date" "date",
    "gender" "text" DEFAULT ''::"text" NOT NULL,
    "province" "text" DEFAULT ''::"text" NOT NULL,
    "town" "text" DEFAULT ''::"text" NOT NULL,
    "town_public" boolean DEFAULT true NOT NULL,
    CONSTRAINT "user_settings_bio_check" CHECK (("char_length"("bio") <= 300)),
    CONSTRAINT "user_settings_contact_number_check" CHECK (("length"("contact_number") <= 20)),
    CONSTRAINT "user_settings_display_name_check" CHECK (("length"("display_name") <= 80)),
    CONSTRAINT "user_settings_display_name_has_link" CHECK ((("display_name" = ''::"text") OR ("public"."profile_slug"("display_name") <> ''::"text"))),
    CONSTRAINT "user_settings_education_field_check" CHECK (("length"("education_field") <= 100)),
    CONSTRAINT "user_settings_education_level_check" CHECK (("education_level" = ANY (ARRAY[''::"text", 'bachelor'::"text", 'master'::"text", 'doctorate'::"text", 'other'::"text"]))),
    CONSTRAINT "user_settings_first_name_check" CHECK (("length"("first_name") <= 35)),
    CONSTRAINT "user_settings_gender_check" CHECK (("gender" = ANY (ARRAY[''::"text", 'male'::"text", 'female'::"text"]))),
    CONSTRAINT "user_settings_last_name_check" CHECK (("length"("last_name") <= 35)),
    CONSTRAINT "user_settings_province_check" CHECK ((("province" = ''::"text") OR "public"."is_province"("province"))),
    CONSTRAINT "user_settings_terms_version_check" CHECK (("char_length"("terms_version") <= 20)),
    CONSTRAINT "user_settings_town_check" CHECK (("char_length"("town") <= 60))
);


ALTER TABLE "public"."user_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."write_rate" (
    "user_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "window_start" timestamp with time zone NOT NULL,
    "writes" integer NOT NULL
);


ALTER TABLE "public"."write_rate" OWNER TO "postgres";


ALTER TABLE ONLY "public"."activity_events"
    ADD CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_actions"
    ADD CONSTRAINT "admin_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admins"
    ADD CONSTRAINT "admins_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."announcement_dismissals"
    ADD CONSTRAINT "announcement_dismissals_pkey" PRIMARY KEY ("announcement_id", "user_id", "part");



ALTER TABLE ONLY "public"."announcements"
    ADD CONSTRAINT "announcements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."banned_users"
    ADD CONSTRAINT "banned_users_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."blocked_email_domains"
    ADD CONSTRAINT "blocked_email_domains_pkey" PRIMARY KEY ("domain");



ALTER TABLE ONLY "public"."click_history"
    ADD CONSTRAINT "click_history_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."click_limits"
    ADD CONSTRAINT "click_limits_pkey" PRIMARY KEY ("feature");



ALTER TABLE ONLY "public"."click_rate"
    ADD CONSTRAINT "click_rate_pkey" PRIMARY KEY ("user_id", "feature");



ALTER TABLE ONLY "public"."editors"
    ADD CONSTRAINT "editors_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."folder_items"
    ADD CONSTRAINT "folder_items_pkey" PRIMARY KEY ("presentation_id");



ALTER TABLE ONLY "public"."folders"
    ADD CONSTRAINT "folders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."maintenance"
    ADD CONSTRAINT "maintenance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."photo_categories"
    ADD CONSTRAINT "photo_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_user_id_src_key" UNIQUE ("user_id", "src");



ALTER TABLE ONLY "public"."presentation_like_counts"
    ADD CONSTRAINT "presentation_like_counts_pkey" PRIMARY KEY ("presentation_id");



ALTER TABLE ONLY "public"."presentation_likes"
    ADD CONSTRAINT "presentation_likes_pkey" PRIMARY KEY ("user_id", "presentation_id");



ALTER TABLE ONLY "public"."presentation_reports"
    ADD CONSTRAINT "presentation_reports_pkey" PRIMARY KEY ("presentation_id", "reporter_id");



ALTER TABLE ONLY "public"."presentation_reviewers"
    ADD CONSTRAINT "presentation_reviewers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."presentation_reviewers"
    ADD CONSTRAINT "presentation_reviewers_presentation_id_reviewer_id_key" UNIQUE ("presentation_id", "reviewer_id");



ALTER TABLE ONLY "public"."presentation_reviews"
    ADD CONSTRAINT "presentation_reviews_pkey" PRIMARY KEY ("presentation_id");



ALTER TABLE ONLY "public"."presentation_submissions"
    ADD CONSTRAINT "presentation_submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."presentation_submissions"
    ADD CONSTRAINT "presentation_submissions_presentation_id_key" UNIQUE ("presentation_id");



ALTER TABLE "public"."presentations"
    ADD CONSTRAINT "presentations_details_size" CHECK ((("char_length"("id") <= 100) AND ("char_length"("title") <= 120) AND ("char_length"("description") <= 1000) AND ("char_length"("subject") <= 80) AND ("char_length"("curriculum") <= 80) AND ("char_length"("learning_competency") <= 1000) AND ("char_length"("author") <= 120) AND (COALESCE("cardinality"("reference_links"), 0) <= 20))) NOT VALID;



ALTER TABLE ONLY "public"."presentations"
    ADD CONSTRAINT "presentations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."presentations"
    ADD CONSTRAINT "presentations_shared_from_key" UNIQUE ("shared_from");



ALTER TABLE "public"."presentations"
    ADD CONSTRAINT "presentations_tags_size" CHECK (("cardinality"("tags") <= 10)) NOT VALID;



ALTER TABLE ONLY "public"."profile_photos"
    ADD CONSTRAINT "profile_photos_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."saved_presentations"
    ADD CONSTRAINT "saved_presentations_pkey" PRIMARY KEY ("user_id", "presentation_id");



ALTER TABLE ONLY "public"."shared_photos"
    ADD CONSTRAINT "shared_photos_pkey" PRIMARY KEY ("src");



ALTER TABLE ONLY "public"."slide_photos"
    ADD CONSTRAINT "slide_photos_pkey" PRIMARY KEY ("presentation_id", "slide_id", "src");



ALTER TABLE "public"."slides"
    ADD CONSTRAINT "slides_data_is_small_object" CHECK ((("jsonb_typeof"("data") = 'object'::"text") AND ("octet_length"(("data")::"text") <= 2000000))) NOT VALID;



ALTER TABLE ONLY "public"."slides"
    ADD CONSTRAINT "slides_pkey" PRIMARY KEY ("presentation_id", "id");



ALTER TABLE ONLY "public"."user_settings"
    ADD CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."write_rate"
    ADD CONSTRAINT "write_rate_pkey" PRIMARY KEY ("user_id", "kind");



CREATE INDEX "activity_events_kind_created_at" ON "public"."activity_events" USING "btree" ("kind", "created_at");



CREATE INDEX "admin_actions_admin_created_at" ON "public"."admin_actions" USING "btree" ("admin_id", "created_at" DESC);



CREATE INDEX "admin_actions_created_at" ON "public"."admin_actions" USING "btree" ("created_at" DESC);



CREATE INDEX "admin_actions_target_id" ON "public"."admin_actions" USING "btree" ("target_id");



CREATE INDEX "announcement_dismissals_user_id" ON "public"."announcement_dismissals" USING "btree" ("user_id");



CREATE INDEX "click_history_created_at" ON "public"."click_history" USING "btree" ("created_at" DESC);



CREATE INDEX "folder_items_folder_id_idx" ON "public"."folder_items" USING "btree" ("folder_id");



CREATE INDEX "folder_items_owner_id_idx" ON "public"."folder_items" USING "btree" ("owner_id");



CREATE UNIQUE INDEX "folders_owner_name_idx" ON "public"."folders" USING "btree" ("owner_id", "lower"("name"));



CREATE UNIQUE INDEX "photo_categories_name" ON "public"."photo_categories" USING "btree" ("lower"("name"));



CREATE INDEX "photos_user_newest" ON "public"."photos" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "presentation_likes_presentation_id_idx" ON "public"."presentation_likes" USING "btree" ("presentation_id");



CREATE INDEX "presentation_submissions_copy_idx" ON "public"."presentation_submissions" USING "btree" ("copy_id");



CREATE INDEX "presentation_submissions_submitter_idx" ON "public"."presentation_submissions" USING "btree" ("submitter_id");



CREATE INDEX "presentations_author_id_idx" ON "public"."presentations" USING "btree" ("author_id") WHERE ("author_id" IS NOT NULL);



CREATE INDEX "presentations_from_admin_updated_at_idx" ON "public"."presentations" USING "btree" ("updated_at" DESC) WHERE ("is_published" AND "from_admin");



CREATE INDEX "presentations_owner_id_idx" ON "public"."presentations" USING "btree" ("owner_id");



CREATE INDEX "presentations_published_updated_at_idx" ON "public"."presentations" USING "btree" ("updated_at" DESC) WHERE "is_published";



CREATE INDEX "presentations_search_text_trgm_idx" ON "public"."presentations" USING "gin" ("search_text" "extensions"."gin_trgm_ops");



CREATE INDEX "saved_presentations_presentation_id_idx" ON "public"."saved_presentations" USING "btree" ("presentation_id");



CREATE INDEX "saved_presentations_user_saved_at_idx" ON "public"."saved_presentations" USING "btree" ("user_id", "saved_at" DESC);



CREATE INDEX "shared_photos_category" ON "public"."shared_photos" USING "btree" ("category_id");



CREATE INDEX "shared_photos_newest" ON "public"."shared_photos" USING "btree" ("created_at" DESC);



CREATE INDEX "sign_up_attempts_ip_created_at" ON "public"."sign_up_attempts" USING "btree" ("ip", "created_at");



CREATE INDEX "slide_photos_src" ON "public"."slide_photos" USING "btree" ("src");



CREATE UNIQUE INDEX "user_settings_profile_slug" ON "public"."user_settings" USING "btree" ("profile_slug") WHERE ("profile_slug" <> ''::"text");



CREATE OR REPLACE TRIGGER "cancel_reviews_of_removed_editor" AFTER DELETE ON "public"."editors" FOR EACH ROW EXECUTE FUNCTION "public"."cancel_reviews_of_removed_editor"();



CREATE OR REPLACE TRIGGER "cap_presentation_data_version" BEFORE INSERT OR UPDATE ON "public"."presentations" FOR EACH ROW EXECUTE FUNCTION "public"."cap_presentation_data_version"();



CREATE OR REPLACE TRIGGER "cap_review_draft_version" BEFORE INSERT OR UPDATE ON "public"."presentation_reviews" FOR EACH ROW EXECUTE FUNCTION "public"."cap_review_draft_version"();



CREATE OR REPLACE TRIGGER "check_ban_target" BEFORE INSERT OR UPDATE ON "public"."banned_users" FOR EACH ROW EXECUTE FUNCTION "public"."check_ban_target"();



CREATE OR REPLACE TRIGGER "check_editor_target" BEFORE INSERT OR UPDATE ON "public"."editors" FOR EACH ROW EXECUTE FUNCTION "public"."check_editor_target"();



CREATE OR REPLACE TRIGGER "check_hidden_change" BEFORE INSERT OR UPDATE ON "public"."presentations" FOR EACH ROW EXECUTE FUNCTION "public"."check_hidden_change"();



CREATE OR REPLACE TRIGGER "count_folder_item_write" AFTER INSERT OR DELETE OR UPDATE ON "public"."folder_items" FOR EACH STATEMENT EXECUTE FUNCTION "public"."count_table_write"('folders');



CREATE OR REPLACE TRIGGER "count_folder_write" AFTER INSERT OR DELETE OR UPDATE ON "public"."folders" FOR EACH STATEMENT EXECUTE FUNCTION "public"."count_table_write"('folders');



CREATE OR REPLACE TRIGGER "count_like" AFTER INSERT OR DELETE ON "public"."presentation_likes" FOR EACH ROW EXECUTE FUNCTION "public"."count_like"();



CREATE OR REPLACE TRIGGER "count_new_presentation" BEFORE INSERT ON "public"."presentations" FOR EACH ROW EXECUTE FUNCTION "public"."count_new_presentation"();



CREATE OR REPLACE TRIGGER "count_photo_write" BEFORE INSERT ON "public"."photos" FOR EACH ROW EXECUTE FUNCTION "public"."count_photo_write"();



CREATE OR REPLACE TRIGGER "count_presentation_write" AFTER INSERT OR DELETE OR UPDATE ON "public"."presentations" FOR EACH STATEMENT EXECUTE FUNCTION "public"."count_presentation_write"();



CREATE OR REPLACE TRIGGER "count_settings_write" AFTER INSERT OR UPDATE ON "public"."user_settings" FOR EACH STATEMENT EXECUTE FUNCTION "public"."count_table_write"('settings');



CREATE OR REPLACE TRIGGER "count_share_clicks" BEFORE INSERT OR UPDATE OF "is_published" ON "public"."presentations" FOR EACH ROW EXECUTE FUNCTION "public"."count_share_clicks"();



CREATE OR REPLACE TRIGGER "count_slide_write" AFTER INSERT OR DELETE OR UPDATE ON "public"."slides" FOR EACH STATEMENT EXECUTE FUNCTION "public"."count_presentation_write"();



CREATE OR REPLACE TRIGGER "drop_unapproved_submission" BEFORE DELETE ON "public"."presentations" FOR EACH ROW EXECUTE FUNCTION "public"."drop_unapproved_submission"();



CREATE OR REPLACE TRIGGER "drop_waiting_editor_photo" AFTER DELETE ON "public"."photos" FOR EACH ROW EXECUTE FUNCTION "public"."drop_waiting_editor_photo"();



CREATE OR REPLACE TRIGGER "folder_limit" BEFORE INSERT ON "public"."folders" FOR EACH ROW EXECUTE FUNCTION "public"."check_folder_limit"();



CREATE OR REPLACE TRIGGER "guard_admin_presentation_update" BEFORE UPDATE ON "public"."presentations" FOR EACH ROW EXECUTE FUNCTION "public"."guard_admin_presentation_update"();



CREATE OR REPLACE TRIGGER "hidden_copy_delete" BEFORE DELETE ON "public"."presentations" FOR EACH ROW EXECUTE FUNCTION "public"."check_hidden_copy_delete"();



CREATE OR REPLACE TRIGGER "keep_author_id" BEFORE INSERT OR UPDATE ON "public"."presentations" FOR EACH ROW EXECUTE FUNCTION "public"."keep_author_id"();



CREATE OR REPLACE TRIGGER "keep_copied_from" BEFORE INSERT OR UPDATE ON "public"."presentations" FOR EACH ROW EXECUTE FUNCTION "public"."keep_copied_from"();



CREATE OR REPLACE TRIGGER "keep_editor_category" BEFORE DELETE OR UPDATE OF "name" ON "public"."photo_categories" FOR EACH ROW EXECUTE FUNCTION "public"."keep_editor_category"();



CREATE OR REPLACE TRIGGER "log_category_change" BEFORE INSERT OR DELETE OR UPDATE OF "name" ON "public"."photo_categories" FOR EACH ROW EXECUTE FUNCTION "public"."log_category_change"();



CREATE OR REPLACE TRIGGER "log_editor_change" BEFORE INSERT OR DELETE ON "public"."editors" FOR EACH ROW EXECUTE FUNCTION "public"."log_editor_change"();



CREATE OR REPLACE TRIGGER "log_presentation_change" BEFORE UPDATE ON "public"."presentations" FOR EACH ROW EXECUTE FUNCTION "public"."log_presentation_change"();



CREATE OR REPLACE TRIGGER "log_presentation_delete" BEFORE DELETE ON "public"."presentations" FOR EACH ROW EXECUTE FUNCTION "public"."log_presentation_delete"();



CREATE OR REPLACE TRIGGER "log_reports_dismissed" AFTER DELETE ON "public"."presentation_reports" REFERENCING OLD TABLE AS "old_reports" FOR EACH STATEMENT EXECUTE FUNCTION "public"."log_reports_dismissed"();



CREATE OR REPLACE TRIGGER "log_review_change" BEFORE UPDATE ON "public"."presentation_reviews" FOR EACH ROW EXECUTE FUNCTION "public"."log_review_change"();



CREATE OR REPLACE TRIGGER "log_review_insert" AFTER INSERT ON "public"."presentation_reviews" FOR EACH ROW EXECUTE FUNCTION "public"."log_review_change"();



CREATE OR REPLACE TRIGGER "log_shared_photo_delete" BEFORE DELETE ON "public"."shared_photos" FOR EACH ROW EXECUTE FUNCTION "public"."log_shared_photo_delete"();



CREATE OR REPLACE TRIGGER "log_submission_change" BEFORE UPDATE ON "public"."presentation_submissions" FOR EACH ROW EXECUTE FUNCTION "public"."log_submission_change"();



CREATE OR REPLACE TRIGGER "presentation_limit" BEFORE INSERT ON "public"."presentations" FOR EACH ROW EXECUTE FUNCTION "public"."check_presentation_limit"();



CREATE OR REPLACE TRIGGER "presentation_review_lock" BEFORE DELETE OR UPDATE ON "public"."presentations" FOR EACH ROW EXECUTE FUNCTION "public"."check_presentation_review_lock"();



CREATE OR REPLACE TRIGGER "publish_photos_of_live_presentation" AFTER UPDATE OF "is_published", "hidden_at" ON "public"."presentations" FOR EACH ROW EXECUTE FUNCTION "public"."publish_photos_of_live_presentation"();



CREATE OR REPLACE TRIGGER "publish_photos_of_new_slide" AFTER INSERT ON "public"."slide_photos" FOR EACH ROW EXECUTE FUNCTION "public"."publish_photos_of_new_slide"();



CREATE OR REPLACE TRIGGER "record_like_event" AFTER INSERT ON "public"."presentation_likes" FOR EACH ROW EXECUTE FUNCTION "public"."record_activity_event"('like');



CREATE OR REPLACE TRIGGER "record_report_event" AFTER INSERT ON "public"."presentation_reports" FOR EACH ROW EXECUTE FUNCTION "public"."record_activity_event"('report');



CREATE OR REPLACE TRIGGER "record_save_event" AFTER INSERT ON "public"."saved_presentations" FOR EACH ROW EXECUTE FUNCTION "public"."record_activity_event"('save');



CREATE OR REPLACE TRIGGER "refuse_banned_write" BEFORE INSERT OR UPDATE ON "public"."folder_items" FOR EACH ROW EXECUTE FUNCTION "public"."refuse_banned_write"();



CREATE OR REPLACE TRIGGER "refuse_banned_write" BEFORE INSERT OR UPDATE ON "public"."presentation_reports" FOR EACH ROW EXECUTE FUNCTION "public"."refuse_banned_write"();



CREATE OR REPLACE TRIGGER "refuse_banned_write" BEFORE INSERT OR UPDATE ON "public"."user_settings" FOR EACH ROW EXECUTE FUNCTION "public"."refuse_banned_write"();



CREATE OR REPLACE TRIGGER "refuse_locked_photo_delete" BEFORE DELETE ON "public"."photos" FOR EACH ROW EXECUTE FUNCTION "public"."refuse_locked_photo_delete"();



CREATE OR REPLACE TRIGGER "refuse_locked_photo_delete" BEFORE DELETE ON "public"."shared_photos" FOR EACH ROW EXECUTE FUNCTION "public"."refuse_locked_photo_delete"();



CREATE OR REPLACE TRIGGER "remove_copy_of_quizmatter_presentation" AFTER UPDATE OF "from_admin" ON "public"."presentations" FOR EACH ROW WHEN (("new"."from_admin" AND (NOT "old"."from_admin"))) EXECUTE FUNCTION "public"."remove_copy_of_quizmatter_presentation"();



CREATE OR REPLACE TRIGGER "remove_new_editor_copies" AFTER INSERT ON "public"."editors" FOR EACH ROW EXECUTE FUNCTION "public"."remove_new_editor_copies"();



CREATE OR REPLACE TRIGGER "set_click_history_email" BEFORE INSERT ON "public"."click_history" FOR EACH ROW EXECUTE FUNCTION "public"."set_click_history_email"();



CREATE OR REPLACE TRIGGER "set_editor_author" BEFORE INSERT OR UPDATE ON "public"."presentations" FOR EACH ROW EXECUTE FUNCTION "public"."set_editor_author"();



CREATE OR REPLACE TRIGGER "share_editor_photo" AFTER INSERT ON "public"."photos" FOR EACH ROW EXECUTE FUNCTION "public"."share_editor_photo"();



CREATE OR REPLACE TRIGGER "share_new_editor_photos" AFTER INSERT ON "public"."editors" FOR EACH ROW EXECUTE FUNCTION "public"."share_new_editor_photos"();



CREATE OR REPLACE TRIGGER "shared_copy_change" BEFORE INSERT OR UPDATE ON "public"."presentations" FOR EACH ROW EXECUTE FUNCTION "public"."check_shared_copy_change"();



CREATE OR REPLACE TRIGGER "shared_copy_slides" BEFORE INSERT OR DELETE OR UPDATE ON "public"."slides" FOR EACH ROW EXECUTE FUNCTION "public"."check_shared_copy_slides"();



CREATE OR REPLACE TRIGGER "slide_limit" BEFORE INSERT OR UPDATE OF "presentation_id" ON "public"."slides" FOR EACH ROW EXECUTE FUNCTION "public"."check_slide_limit"();



CREATE OR REPLACE TRIGGER "slide_review_lock" BEFORE INSERT OR DELETE OR UPDATE ON "public"."slides" FOR EACH ROW EXECUTE FUNCTION "public"."check_slide_review_lock"();



CREATE OR REPLACE TRIGGER "submission_not_copy" BEFORE INSERT ON "public"."presentation_submissions" FOR EACH ROW EXECUTE FUNCTION "public"."check_submission_not_copy"();



CREATE OR REPLACE TRIGGER "sync_slide_photos" AFTER INSERT OR UPDATE OF "data" ON "public"."slides" FOR EACH ROW EXECUTE FUNCTION "public"."sync_slide_photos"();



CREATE OR REPLACE TRIGGER "user_settings_check_birth_date" BEFORE INSERT OR UPDATE OF "birth_date" ON "public"."user_settings" FOR EACH ROW EXECUTE FUNCTION "public"."check_birth_date"();



CREATE OR REPLACE TRIGGER "user_settings_display_name_guard" BEFORE INSERT OR DELETE OR UPDATE OF "display_name", "display_name_changed_at" ON "public"."user_settings" FOR EACH ROW EXECUTE FUNCTION "public"."guard_display_name"();



CREATE OR REPLACE TRIGGER "user_settings_keep_terms_consent" BEFORE INSERT OR UPDATE ON "public"."user_settings" FOR EACH ROW EXECUTE FUNCTION "public"."keep_terms_consent"();



ALTER TABLE ONLY "public"."admin_actions"
    ADD CONSTRAINT "admin_actions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."admins"
    ADD CONSTRAINT "admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."announcement_dismissals"
    ADD CONSTRAINT "announcement_dismissals_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."announcement_dismissals"
    ADD CONSTRAINT "announcement_dismissals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."announcements"
    ADD CONSTRAINT "announcements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."banned_users"
    ADD CONSTRAINT "banned_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."click_history"
    ADD CONSTRAINT "click_history_feature_fkey" FOREIGN KEY ("feature") REFERENCES "public"."click_limits"("feature") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."click_history"
    ADD CONSTRAINT "click_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."click_rate"
    ADD CONSTRAINT "click_rate_feature_fkey" FOREIGN KEY ("feature") REFERENCES "public"."click_limits"("feature") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."click_rate"
    ADD CONSTRAINT "click_rate_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."editors"
    ADD CONSTRAINT "editors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."folder_items"
    ADD CONSTRAINT "folder_items_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."folder_items"
    ADD CONSTRAINT "folder_items_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."folder_items"
    ADD CONSTRAINT "folder_items_presentation_id_fkey" FOREIGN KEY ("presentation_id") REFERENCES "public"."presentations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."folders"
    ADD CONSTRAINT "folders_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."maintenance"
    ADD CONSTRAINT "maintenance_started_by_fkey" FOREIGN KEY ("started_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."presentation_like_counts"
    ADD CONSTRAINT "presentation_like_counts_presentation_id_fkey" FOREIGN KEY ("presentation_id") REFERENCES "public"."presentations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."presentation_likes"
    ADD CONSTRAINT "presentation_likes_presentation_id_fkey" FOREIGN KEY ("presentation_id") REFERENCES "public"."presentations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."presentation_likes"
    ADD CONSTRAINT "presentation_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."presentation_reports"
    ADD CONSTRAINT "presentation_reports_presentation_id_fkey" FOREIGN KEY ("presentation_id") REFERENCES "public"."presentations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."presentation_reports"
    ADD CONSTRAINT "presentation_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."presentation_reviewers"
    ADD CONSTRAINT "presentation_reviewers_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."presentation_reviewers"
    ADD CONSTRAINT "presentation_reviewers_presentation_id_fkey" FOREIGN KEY ("presentation_id") REFERENCES "public"."presentations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."presentation_reviewers"
    ADD CONSTRAINT "presentation_reviewers_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."presentation_reviews"
    ADD CONSTRAINT "presentation_reviews_last_reviewer_id_fkey" FOREIGN KEY ("last_reviewer_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."presentation_reviews"
    ADD CONSTRAINT "presentation_reviews_presentation_id_fkey" FOREIGN KEY ("presentation_id") REFERENCES "public"."presentations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."presentation_reviews"
    ADD CONSTRAINT "presentation_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."presentation_submissions"
    ADD CONSTRAINT "presentation_submissions_copy_id_fkey" FOREIGN KEY ("copy_id") REFERENCES "public"."presentations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."presentation_submissions"
    ADD CONSTRAINT "presentation_submissions_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."presentation_submissions"
    ADD CONSTRAINT "presentation_submissions_presentation_id_fkey" FOREIGN KEY ("presentation_id") REFERENCES "public"."presentations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."presentation_submissions"
    ADD CONSTRAINT "presentation_submissions_submitter_id_fkey" FOREIGN KEY ("submitter_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."presentations"
    ADD CONSTRAINT "presentations_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."presentations"
    ADD CONSTRAINT "presentations_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."presentations"
    ADD CONSTRAINT "presentations_shared_from_fkey" FOREIGN KEY ("shared_from") REFERENCES "public"."presentations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profile_photos"
    ADD CONSTRAINT "profile_photos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."editors"("user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."saved_presentations"
    ADD CONSTRAINT "saved_presentations_presentation_id_fkey" FOREIGN KEY ("presentation_id") REFERENCES "public"."presentations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."saved_presentations"
    ADD CONSTRAINT "saved_presentations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."shared_photos"
    ADD CONSTRAINT "shared_photos_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."photo_categories"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."shared_photos"
    ADD CONSTRAINT "shared_photos_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."slide_photos"
    ADD CONSTRAINT "slide_photos_presentation_id_slide_id_fkey" FOREIGN KEY ("presentation_id", "slide_id") REFERENCES "public"."slides"("presentation_id", "id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."slides"
    ADD CONSTRAINT "slides_presentation_id_fkey" FOREIGN KEY ("presentation_id") REFERENCES "public"."presentations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_settings"
    ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."write_rate"
    ADD CONSTRAINT "write_rate_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Add own folder items" ON "public"."folder_items" FOR INSERT TO "authenticated" WITH CHECK ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."folders" "f"
  WHERE (("f"."id" = "folder_items"."folder_id") AND ("f"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))) AND (EXISTS ( SELECT 1
   FROM "public"."presentations" "p"
  WHERE (("p"."id" = "folder_items"."presentation_id") AND ("p"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Admins add categories" ON "public"."photo_categories" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins add shared photos" ON "public"."shared_photos" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "public"."is_admin"() AS "is_admin") AND ("uploaded_by" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Admins delete reported or hidden presentations" ON "public"."presentations" FOR DELETE TO "authenticated" USING ("public"."admin_may_delete"("id"));



CREATE POLICY "Admins hide any presentation" ON "public"."presentations" FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins manage reports" ON "public"."presentation_reports" TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin")) WITH CHECK (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins read editors" ON "public"."editors" FOR SELECT TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins read every presentation" ON "public"."presentations" FOR SELECT TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins read every slide" ON "public"."slides" FOR SELECT TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Admins remove editors" ON "public"."editors" FOR DELETE TO "authenticated" USING (( SELECT "public"."is_admin"() AS "is_admin"));



CREATE POLICY "Anyone reads the blocked email domains" ON "public"."blocked_email_domains" FOR SELECT TO "authenticated", "anon", "supabase_auth_admin" USING (true);



CREATE POLICY "Auth adds sign up attempts" ON "public"."sign_up_attempts" FOR INSERT TO "supabase_auth_admin" WITH CHECK (true);



CREATE POLICY "Auth reads sign up attempts" ON "public"."sign_up_attempts" FOR SELECT TO "supabase_auth_admin" USING (true);



CREATE POLICY "Everyone reads categories" ON "public"."photo_categories" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Everyone reads public shared photos" ON "public"."shared_photos" FOR SELECT TO "authenticated" USING (("is_public" OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Move own folder items" ON "public"."folder_items" FOR UPDATE TO "authenticated" USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK ((("owner_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."folders" "f"
  WHERE (("f"."id" = "folder_items"."folder_id") AND ("f"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))) AND (EXISTS ( SELECT 1
   FROM "public"."presentations" "p"
  WHERE (("p"."id" = "folder_items"."presentation_id") AND ("p"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Only admins delete QuizMatter presentations" ON "public"."presentations" AS RESTRICTIVE FOR DELETE TO "authenticated" USING (((NOT "from_admin") OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Only admins save admin presentations" ON "public"."presentations" AS RESTRICTIVE TO "authenticated" USING (true) WITH CHECK (((NOT "from_admin") OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Own folders" ON "public"."folders" TO "authenticated" USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Own photos" ON "public"."photos" TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Own presentations" ON "public"."presentations" TO "authenticated" USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Own settings" ON "public"."user_settings" TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Owners change shared photos" ON "public"."shared_photos" FOR UPDATE TO "authenticated" USING ((( SELECT "public"."is_super_admin"() AS "is_super_admin") OR (( SELECT "public"."is_admin"() AS "is_admin") AND ("uploaded_by" = ( SELECT "auth"."uid"() AS "uid"))))) WITH CHECK ((( SELECT "public"."is_super_admin"() AS "is_super_admin") OR (( SELECT "public"."is_admin"() AS "is_admin") AND ("uploaded_by" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Owners remove shared photos" ON "public"."shared_photos" FOR DELETE TO "authenticated" USING ((( SELECT "public"."is_super_admin"() AS "is_super_admin") OR (( SELECT "public"."is_admin"() AS "is_admin") AND ("uploaded_by" = ( SELECT "auth"."uid"() AS "uid")))));



CREATE POLICY "Read like counts" ON "public"."presentation_like_counts" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."presentations" "p"
  WHERE ("p"."id" = "presentation_like_counts"."presentation_id"))));



CREATE POLICY "Read own folder items" ON "public"."folder_items" FOR SELECT TO "authenticated" USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Read own likes" ON "public"."presentation_likes" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Read own saved presentations" ON "public"."saved_presentations" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Read published presentations" ON "public"."presentations" FOR SELECT TO "authenticated" USING (("is_published" AND ("hidden_at" IS NULL)));



CREATE POLICY "Read reviewers of readable presentations" ON "public"."presentation_reviewers" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."presentations" "p"
  WHERE ("p"."id" = "presentation_reviewers"."presentation_id"))));



CREATE POLICY "Read slides of published presentations" ON "public"."slides" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."presentations" "p"
  WHERE (("p"."id" = "slides"."presentation_id") AND "p"."is_published" AND ("p"."hidden_at" IS NULL)))));



CREATE POLICY "Remove own folder items" ON "public"."folder_items" FOR DELETE TO "authenticated" USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Remove own saved presentations" ON "public"."saved_presentations" FOR DELETE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Report other teachers' presentations" ON "public"."presentation_reports" FOR INSERT TO "authenticated" WITH CHECK ((("reporter_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."presentations" "p"
  WHERE (("p"."id" = "presentation_reports"."presentation_id") AND "p"."is_published" AND ("p"."owner_id" <> ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Reviewer and admins read reviews" ON "public"."presentation_reviews" FOR SELECT TO "authenticated" USING ((("reviewer_id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "public"."is_admin"() AS "is_admin")));



CREATE POLICY "Save other people's presentations" ON "public"."saved_presentations" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."presentations" "p"
  WHERE (("p"."id" = "saved_presentations"."presentation_id") AND "p"."is_published" AND ("p"."hidden_at" IS NULL) AND ("p"."owner_id" <> ( SELECT "auth"."uid"() AS "uid")))))));



CREATE POLICY "Slides of own presentations" ON "public"."slides" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."presentations" "q"
  WHERE (("q"."id" = "slides"."presentation_id") AND ("q"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."presentations" "q"
  WHERE (("q"."id" = "slides"."presentation_id") AND ("q"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "Super admin adds editors" ON "public"."editors" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "public"."is_super_admin"() AS "is_super_admin"));



CREATE POLICY "Super admin changes categories" ON "public"."photo_categories" FOR UPDATE TO "authenticated" USING (( SELECT "public"."is_super_admin"() AS "is_super_admin")) WITH CHECK (( SELECT "public"."is_super_admin"() AS "is_super_admin"));



CREATE POLICY "Super admin manages bans" ON "public"."banned_users" TO "authenticated" USING (( SELECT "public"."is_super_admin"() AS "is_super_admin")) WITH CHECK (( SELECT "public"."is_super_admin"() AS "is_super_admin"));



CREATE POLICY "Super admin manages every presentation" ON "public"."presentations" TO "authenticated" USING (( SELECT "public"."is_super_admin"() AS "is_super_admin")) WITH CHECK (( SELECT "public"."is_super_admin"() AS "is_super_admin"));



CREATE POLICY "Super admin reads the admin log" ON "public"."admin_actions" FOR SELECT TO "authenticated" USING (( SELECT "public"."is_super_admin"() AS "is_super_admin"));



CREATE POLICY "Super admin removes categories" ON "public"."photo_categories" FOR DELETE TO "authenticated" USING (( SELECT "public"."is_super_admin"() AS "is_super_admin"));



CREATE POLICY "The maintenance guard reads the row" ON "public"."maintenance" FOR SELECT TO "authenticated", "anon", "service_role" USING (true);



ALTER TABLE "public"."activity_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."admin_actions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."admins" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."announcement_dismissals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."announcements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."banned_users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."blocked_email_domains" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."click_history" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."click_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."click_rate" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."editors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."folder_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."folders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."maintenance" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."photo_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."photos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."presentation_like_counts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."presentation_likes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."presentation_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."presentation_reviewers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."presentation_reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."presentation_submissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."presentations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profile_photos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."saved_presentations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."shared_photos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sign_up_attempts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."slide_photos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."slides" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."write_rate" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
GRANT USAGE ON SCHEMA "public" TO "supabase_auth_admin";



REVOKE ALL ON FUNCTION "public"."admin_announcements"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_announcements"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_announcements"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_cancel_review"("target_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_cancel_review"("target_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_cancel_review"("target_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_editors"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_editors"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_editors"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_log_name"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_log_name"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_may_delete"("target_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_may_delete"("target_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_may_delete"("target_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_overview"("days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_overview"("days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_overview"("days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_remove_profile_photo"("target" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_remove_profile_photo"("target" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_remove_profile_photo"("target" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_reviewers"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_reviewers"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_reviewers"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_reviews"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_reviews"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_reviews"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_submissions"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_submissions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_submissions"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_teacher_breakdown"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_teacher_breakdown"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_teacher_breakdown"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_todo_counts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_todo_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_todo_counts"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_used_photo_srcs"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_used_photo_srcs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_used_photo_srcs"() TO "service_role";



GRANT ALL ON FUNCTION "public"."age_on"("birth" "date", "today" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."age_on"("birth" "date", "today" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."age_on"("birth" "date", "today" "date") TO "service_role";



REVOKE ALL ON FUNCTION "public"."announce_maintenance"("planned" timestamp with time zone, "note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."announce_maintenance"("planned" timestamp with time zone, "note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."announce_maintenance"("planned" timestamp with time zone, "note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."announcement_attachment_from_html"("html" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."announcement_attachment_from_html"("html" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."announcement_attachment_ok"("a" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."announcement_attachment_ok"("a" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."announcement_audience"("a" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."announcement_audience"("a" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."announcement_audience"("a" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."announcement_provinces_ok"("names" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."announcement_provinces_ok"("names" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."announcement_words_ok"("words" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."announcement_words_ok"("words" "text"[]) TO "service_role";



GRANT ALL ON TABLE "public"."announcements" TO "service_role";



REVOKE ALL ON FUNCTION "public"."announcement_count"("a" "public"."announcements") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."announcement_count"("a" "public"."announcements") TO "service_role";



REVOKE ALL ON FUNCTION "public"."announcement_is_live"("a" "public"."announcements") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."announcement_is_live"("a" "public"."announcements") TO "service_role";



REVOKE ALL ON FUNCTION "public"."announcement_matches"("a" "public"."announcements", "uid" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."announcement_matches"("a" "public"."announcements", "uid" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."announcement_picture_ok"("a" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."announcement_picture_ok"("a" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."announcement_text_from_html"("html" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."announcement_text_from_html"("html" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."approve_submission"("target_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."approve_submission"("target_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."approve_submission"("target_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."before_account_delete"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."before_account_delete"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_review"("target_id" "text", "by_admin" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_review"("target_id" "text", "by_admin" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_reviews_of_removed_editor"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_reviews_of_removed_editor"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."cap_presentation_data_version"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cap_presentation_data_version"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."cap_review_draft_version"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cap_review_draft_version"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_announcement_limit"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_announcement_limit"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_ban_target"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_ban_target"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_birth_date"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_birth_date"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_editor_target"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_editor_target"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_folder_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_folder_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_folder_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_hidden_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_hidden_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_hidden_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_hidden_copy_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_hidden_copy_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_hidden_copy_delete"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_maintenance"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_maintenance"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_maintenance"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_maintenance"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_presentation_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_presentation_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_presentation_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_presentation_review_lock"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_presentation_review_lock"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_presentation_review_lock"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_review_draft"("target_id" "text", "review_draft" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_review_draft"("target_id" "text", "review_draft" "jsonb") TO "service_role";



GRANT ALL ON TABLE "public"."presentation_reviews" TO "anon";
GRANT ALL ON TABLE "public"."presentation_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."presentation_reviews" TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_review_version"("review" "public"."presentation_reviews", "app_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_review_version"("review" "public"."presentation_reviews", "app_version" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."check_shared_copy_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_shared_copy_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_shared_copy_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_shared_copy_slides"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_shared_copy_slides"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_shared_copy_slides"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_slide_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_slide_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_slide_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_slide_review_lock"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_slide_review_lock"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_slide_review_lock"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_submission_not_copy"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_submission_not_copy"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_submission_not_copy"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_display_name"("slug" "text", "me" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_display_name"("slug" "text", "me" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cleanup_announcement_dismissals"("batch_size" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cleanup_announcement_dismissals"("batch_size" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."count_announcement"("target" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."count_announcement"("target" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."count_click"("feature" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."count_click"("feature" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."count_click"("feature" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."count_like"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."count_like"() TO "service_role";



GRANT ALL ON FUNCTION "public"."count_new_presentation"() TO "anon";
GRANT ALL ON FUNCTION "public"."count_new_presentation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."count_new_presentation"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."count_photo_upload"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."count_photo_upload"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."count_photo_upload"() TO "service_role";



GRANT ALL ON FUNCTION "public"."count_photo_write"() TO "anon";
GRANT ALL ON FUNCTION "public"."count_photo_write"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."count_photo_write"() TO "service_role";



GRANT ALL ON FUNCTION "public"."count_presentation_write"() TO "anon";
GRANT ALL ON FUNCTION "public"."count_presentation_write"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."count_presentation_write"() TO "service_role";



GRANT ALL ON FUNCTION "public"."count_share_clicks"() TO "anon";
GRANT ALL ON FUNCTION "public"."count_share_clicks"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."count_share_clicks"() TO "service_role";



GRANT ALL ON FUNCTION "public"."count_table_write"() TO "anon";
GRANT ALL ON FUNCTION "public"."count_table_write"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."count_table_write"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."count_write"("kind" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."count_write"("kind" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."count_write"("kind" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_data_version"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_data_version"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_announcement"("target" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_announcement"("target" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_announcement"("target" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."dismiss_announcement"("target" "uuid", "part" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."dismiss_announcement"("target" "uuid", "part" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."dismiss_announcement"("target" "uuid", "part" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."drop_unapproved_submission"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."drop_unapproved_submission"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."drop_waiting_editor_photo"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."drop_waiting_editor_photo"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."editor_author"("user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."editor_author"("user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."editor_presentations"("slug" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."editor_presentations"("slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."editor_presentations"("slug" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."grades_from"("details" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."grades_from"("details" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."grades_from"("details" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_admin_presentation_update"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guard_admin_presentation_update"() TO "service_role";



GRANT ALL ON FUNCTION "public"."guard_display_name"() TO "anon";
GRANT ALL ON FUNCTION "public"."guard_display_name"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."guard_display_name"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."has_publishable_content"("target_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_publishable_content"("target_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."has_publishable_content"("target_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."hook_before_user_created"("event" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."hook_before_user_created"("event" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."hook_before_user_created"("event" "jsonb") TO "supabase_auth_admin";



REVOKE ALL ON FUNCTION "public"."is_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_banned"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_banned"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_banned"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_editor"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_editor"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_editor"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_province"("name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."is_province"("name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_province"("name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_review_locked"("target_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_review_locked"("target_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_review_locked"("target_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_super_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."keep_author_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."keep_author_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."keep_author_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."keep_copied_from"() TO "anon";
GRANT ALL ON FUNCTION "public"."keep_copied_from"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."keep_copied_from"() TO "service_role";



GRANT ALL ON FUNCTION "public"."keep_editor_category"() TO "anon";
GRANT ALL ON FUNCTION "public"."keep_editor_category"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."keep_editor_category"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."keep_terms_consent"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."keep_terms_consent"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."lesson_editor"("target_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."lesson_editor"("target_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."lesson_extras"("target_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."lesson_extras"("target_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lesson_extras"("target_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."lesson_week"("target_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."lesson_week"("target_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_admin_action"("action" "text", "target_type" "text", "target_id" "text", "target_title" "text", "details" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_admin_action"("action" "text", "target_type" "text", "target_id" "text", "target_title" "text", "details" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_ban"("target" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_ban"("target" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_ban"("target" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_category_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_category_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_click_release"("target" "uuid", "feature" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_click_release"("target" "uuid", "feature" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_click_release"("target" "uuid", "feature" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_editor_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_editor_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_presentation_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_presentation_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_presentation_delete"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_presentation_delete"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_reports_dismissed"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_reports_dismissed"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_review_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_review_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_shared_photo_delete"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_shared_photo_delete"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_submission_change"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_submission_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_unban"("target" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_unban"("target" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_unban"("target" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."maintenance_status"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."maintenance_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."maintenance_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."maintenance_status"() TO "service_role";
GRANT ALL ON FUNCTION "public"."maintenance_status"() TO "supabase_auth_admin";



GRANT ALL ON FUNCTION "public"."manila_today"() TO "anon";
GRANT ALL ON FUNCTION "public"."manila_today"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."manila_today"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_announcements"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_announcements"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_announcements"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_open_review"("target_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_open_review"("target_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_paused_features"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_paused_features"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_paused_features"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_profile_photo"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_profile_photo"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_profile_photo"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_reviews"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_reviews"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_reviews"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_submissions"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_submissions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_submissions"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."photo_waiting_for_approval"("target_src" "text", "owner" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."photo_waiting_for_approval"("target_src" "text", "owner" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."profile_is_visible"("profile_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."profile_is_visible"("profile_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."profile_slug"("name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."profile_slug"("name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."profile_slug"("name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."publish_photos_of_live_presentation"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."publish_photos_of_live_presentation"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."publish_photos_of_new_slide"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."publish_photos_of_new_slide"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."publish_review"("target_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."publish_review"("target_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."publish_review"("target_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."publish_waiting_photos"("target_presentation" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."publish_waiting_photos"("target_presentation" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."publisher_names"("owner_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."publisher_names"("owner_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."publisher_names"("owner_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."random_name_ending"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."random_name_ending"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_activity_event"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_activity_event"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."recount_announcement"("target" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recount_announcement"("target" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."recount_announcement"("target" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."refuse_banned_write"() TO "anon";
GRANT ALL ON FUNCTION "public"."refuse_banned_write"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refuse_banned_write"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."refuse_locked_photo_delete"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."refuse_locked_photo_delete"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."remove_copy_of_quizmatter_presentation"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."remove_copy_of_quizmatter_presentation"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."remove_new_editor_copies"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."remove_new_editor_copies"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."remove_profile_photo"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."remove_profile_photo"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."remove_profile_photo"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."review_status"("target_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."review_status"("target_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."review_status"("target_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_announcement"("a" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_announcement"("a" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_announcement"("a" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_presentation"("presentation" "jsonb", "slide_ids" "text"[], "base_updated_at" bigint, "app_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_presentation"("presentation" "jsonb", "slide_ids" "text"[], "base_updated_at" bigint, "app_version" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_presentation"("presentation" "jsonb", "slide_ids" "text"[], "base_updated_at" bigint, "app_version" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_review_draft"("target_id" "text", "review_draft" "jsonb", "base_updated_at" bigint, "app_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_review_draft"("target_id" "text", "review_draft" "jsonb", "base_updated_at" bigint, "app_version" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_review_draft"("target_id" "text", "review_draft" "jsonb", "base_updated_at" bigint, "app_version" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."search_shared_photos"("query" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."search_shared_photos"("query" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."send_back_review"("target_id" "text", "note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."send_back_review"("target_id" "text", "note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."send_back_review"("target_id" "text", "note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."send_back_submission"("target_id" "text", "note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."send_back_submission"("target_id" "text", "note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."send_back_submission"("target_id" "text", "note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_announcement_on"("target" "uuid", "turn_on" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_announcement_on"("target" "uuid", "turn_on" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_announcement_on"("target" "uuid", "turn_on" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_click_history_email"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_click_history_email"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_display_name"("name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_display_name"("name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_display_name"("name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_editor_author"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_editor_author"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_liked"("presentation_id" "text", "is_liked" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_liked"("presentation_id" "text", "is_liked" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_liked"("presentation_id" "text", "is_liked" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_maintenance"("turn_on" boolean, "note" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_maintenance"("turn_on" boolean, "note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_maintenance"("turn_on" boolean, "note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_profile_photo"("src" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_profile_photo"("src" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_profile_photo"("src" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_review_open"("target_id" "text", "is_open" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_review_open"("target_id" "text", "is_open" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_review_open"("target_id" "text", "is_open" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_saved"("presentation_id" "text", "is_saved" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_saved"("presentation_id" "text", "is_saved" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_saved"("presentation_id" "text", "is_saved" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."share_editor_photo"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."share_editor_photo"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."share_new_editor_photos"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."share_new_editor_photos"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."share_presentation"("target_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."share_presentation"("target_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."share_presentation"("target_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."slide_photo_srcs"("data" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."slide_photo_srcs"("data" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."slide_photo_srcs"("data" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."start_review"("target_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."start_review"("target_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."start_review"("target_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."stop_review"("target_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."stop_review"("target_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."stop_review"("target_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."strip_sign_up_details"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."strip_sign_up_details"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."submission_status"("target_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submission_status"("target_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submission_status"("target_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."submit_presentation"("target_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_presentation"("target_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_presentation"("target_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."submit_review"("target_id" "text", "review_draft" "jsonb", "reviewed_on" "date", "base_updated_at" bigint, "app_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_review"("target_id" "text", "review_draft" "jsonb", "reviewed_on" "date", "base_updated_at" bigint, "app_version" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_review"("target_id" "text", "review_draft" "jsonb", "reviewed_on" "date", "base_updated_at" bigint, "app_version" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_slide_photos"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_slide_photos"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."tags_text"("tags" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tags_text"("tags" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."tags_text"("tags" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."teacher_profile"("slug" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."teacher_profile"("slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."teacher_profile"("slug" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."teacher_shared_presentations"("slug" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."teacher_shared_presentations"("slug" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."teacher_shared_presentations"("slug" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."unshare_presentation"("target_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."unshare_presentation"("target_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unshare_presentation"("target_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."used_photo_srcs"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."used_photo_srcs"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."visible_profiles"("profile_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."visible_profiles"("profile_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."visible_profiles"("profile_ids" "uuid"[]) TO "service_role";



GRANT ALL ON TABLE "public"."activity_events" TO "anon";
GRANT ALL ON TABLE "public"."activity_events" TO "authenticated";
GRANT ALL ON TABLE "public"."activity_events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."activity_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."activity_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."activity_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."admin_actions" TO "service_role";
GRANT SELECT ON TABLE "public"."admin_actions" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."admin_actions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."admin_actions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."admin_actions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."admins" TO "anon";
GRANT ALL ON TABLE "public"."admins" TO "authenticated";
GRANT ALL ON TABLE "public"."admins" TO "service_role";



GRANT ALL ON TABLE "public"."announcement_dismissals" TO "service_role";



GRANT ALL ON TABLE "public"."banned_users" TO "anon";
GRANT ALL ON TABLE "public"."banned_users" TO "authenticated";
GRANT ALL ON TABLE "public"."banned_users" TO "service_role";



GRANT ALL ON TABLE "public"."blocked_email_domains" TO "service_role";
GRANT SELECT ON TABLE "public"."blocked_email_domains" TO "anon";
GRANT SELECT ON TABLE "public"."blocked_email_domains" TO "authenticated";
GRANT SELECT ON TABLE "public"."blocked_email_domains" TO "supabase_auth_admin";



GRANT ALL ON TABLE "public"."click_history" TO "anon";
GRANT ALL ON TABLE "public"."click_history" TO "authenticated";
GRANT ALL ON TABLE "public"."click_history" TO "service_role";



GRANT ALL ON SEQUENCE "public"."click_history_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."click_history_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."click_history_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."click_limits" TO "anon";
GRANT ALL ON TABLE "public"."click_limits" TO "authenticated";
GRANT ALL ON TABLE "public"."click_limits" TO "service_role";



GRANT ALL ON TABLE "public"."click_rate" TO "anon";
GRANT ALL ON TABLE "public"."click_rate" TO "authenticated";
GRANT ALL ON TABLE "public"."click_rate" TO "service_role";



GRANT ALL ON TABLE "public"."editors" TO "anon";
GRANT ALL ON TABLE "public"."editors" TO "authenticated";
GRANT ALL ON TABLE "public"."editors" TO "service_role";



GRANT ALL ON TABLE "public"."folder_items" TO "anon";
GRANT ALL ON TABLE "public"."folder_items" TO "authenticated";
GRANT ALL ON TABLE "public"."folder_items" TO "service_role";



GRANT ALL ON TABLE "public"."folders" TO "anon";
GRANT ALL ON TABLE "public"."folders" TO "authenticated";
GRANT ALL ON TABLE "public"."folders" TO "service_role";



GRANT ALL ON TABLE "public"."maintenance" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."maintenance" TO "anon";
GRANT SELECT("id") ON TABLE "public"."maintenance" TO "authenticated";
GRANT SELECT("id") ON TABLE "public"."maintenance" TO "service_role";



GRANT SELECT("is_on") ON TABLE "public"."maintenance" TO "anon";
GRANT SELECT("is_on") ON TABLE "public"."maintenance" TO "authenticated";
GRANT SELECT("is_on") ON TABLE "public"."maintenance" TO "service_role";



GRANT ALL ON TABLE "public"."photo_categories" TO "anon";
GRANT ALL ON TABLE "public"."photo_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."photo_categories" TO "service_role";



GRANT ALL ON TABLE "public"."photos" TO "anon";
GRANT ALL ON TABLE "public"."photos" TO "authenticated";
GRANT ALL ON TABLE "public"."photos" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."presentation_like_counts" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."presentation_like_counts" TO "authenticated";
GRANT ALL ON TABLE "public"."presentation_like_counts" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."presentation_likes" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."presentation_likes" TO "authenticated";
GRANT ALL ON TABLE "public"."presentation_likes" TO "service_role";



GRANT ALL ON TABLE "public"."presentation_reports" TO "anon";
GRANT ALL ON TABLE "public"."presentation_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."presentation_reports" TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."presentation_reviewers" TO "anon";
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."presentation_reviewers" TO "authenticated";
GRANT ALL ON TABLE "public"."presentation_reviewers" TO "service_role";



GRANT SELECT("presentation_id") ON TABLE "public"."presentation_reviewers" TO "authenticated";



GRANT SELECT("reviewer_id") ON TABLE "public"."presentation_reviewers" TO "authenticated";



GRANT SELECT("name") ON TABLE "public"."presentation_reviewers" TO "authenticated";



GRANT SELECT("email") ON TABLE "public"."presentation_reviewers" TO "authenticated";



GRANT SELECT("reviewed_on") ON TABLE "public"."presentation_reviewers" TO "authenticated";



GRANT ALL ON TABLE "public"."presentation_submissions" TO "anon";
GRANT ALL ON TABLE "public"."presentation_submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."presentation_submissions" TO "service_role";



GRANT ALL ON TABLE "public"."presentations" TO "anon";
GRANT ALL ON TABLE "public"."presentations" TO "authenticated";
GRANT ALL ON TABLE "public"."presentations" TO "service_role";



GRANT ALL ON TABLE "public"."profile_photos" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."saved_presentations" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."saved_presentations" TO "authenticated";
GRANT ALL ON TABLE "public"."saved_presentations" TO "service_role";



GRANT ALL ON TABLE "public"."shared_photos" TO "anon";
GRANT ALL ON TABLE "public"."shared_photos" TO "authenticated";
GRANT ALL ON TABLE "public"."shared_photos" TO "service_role";



GRANT ALL ON TABLE "public"."shared_photo_counts" TO "authenticated";
GRANT ALL ON TABLE "public"."shared_photo_counts" TO "service_role";



GRANT ALL ON TABLE "public"."shared_photos_search" TO "authenticated";
GRANT ALL ON TABLE "public"."shared_photos_search" TO "service_role";



GRANT ALL ON TABLE "public"."sign_up_attempts" TO "service_role";
GRANT SELECT,INSERT ON TABLE "public"."sign_up_attempts" TO "supabase_auth_admin";



GRANT ALL ON TABLE "public"."slide_photos" TO "anon";
GRANT ALL ON TABLE "public"."slide_photos" TO "authenticated";
GRANT ALL ON TABLE "public"."slide_photos" TO "service_role";



GRANT ALL ON TABLE "public"."slides" TO "anon";
GRANT ALL ON TABLE "public"."slides" TO "authenticated";
GRANT ALL ON TABLE "public"."slides" TO "service_role";



GRANT ALL ON TABLE "public"."user_settings" TO "anon";
GRANT ALL ON TABLE "public"."user_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."user_settings" TO "service_role";



GRANT ALL ON TABLE "public"."write_rate" TO "anon";
GRANT ALL ON TABLE "public"."write_rate" TO "authenticated";
GRANT ALL ON TABLE "public"."write_rate" TO "service_role";



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
