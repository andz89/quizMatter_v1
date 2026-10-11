-- The Background panel's patterns are gone: clear every slide's pattern frame and Claude's old background art
-- (backgroundSvg, with backgroundPattern and backgroundOpacity). The background color stays.

-- Slides of presentations under review are locked; this is the same pass publish_review uses, for this run only.
select set_config('quizmatter.publishing_review', 'yes', true);

update public.slides
set data = data - 'backgroundSvg' - 'backgroundPattern' - 'backgroundOpacity'
where data ?| array['backgroundSvg', 'backgroundPattern', 'backgroundOpacity'];

-- A reviewer's draft holds its own copy of the slides, so a pattern can't come back when it's published.
update public.presentation_reviews
set draft = jsonb_set(
  draft,
  '{slides}',
  (
    select jsonb_agg(slide - 'backgroundSvg' - 'backgroundPattern' - 'backgroundOpacity' order by n)
    from jsonb_array_elements(draft -> 'slides') with ordinality as s (slide, n)
  )
)
where jsonb_typeof(draft -> 'slides') = 'array'
  and exists (
    select 1 from jsonb_array_elements(draft -> 'slides') as s (slide)
    where slide ?| array['backgroundSvg', 'backgroundPattern', 'backgroundOpacity']
  );
