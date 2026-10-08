-- Grade: "N/A" left the grade list (src/lib/schema.ts GRADES), which now ends with "Other…" for the teacher's own
-- grade. A presentation that had "N/A" gets no grade, so the Details panel shows "None" until one is picked.
-- (Grade is plain text in the database, so nothing else changes here.)

update public.presentations set grade = '' where grade = 'N/A';
