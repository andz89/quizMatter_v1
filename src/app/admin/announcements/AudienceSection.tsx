"use client";

import { useState, useTransition } from "react";
import { Spinner } from "@/components/Spinner";
import { NEW_ANNOUNCEMENT, splitWords } from "@/lib/announcementForm";
import {
  ANNOUNCEMENT_LIMITS as L,
  ANNOUNCEMENT_ROLES,
  ROLE_LABELS,
  type AnnouncementInput,
} from "@/lib/announcements";
import { EDUCATION_LEVELS, EDUCATION_LEVEL_LABELS, GENDERS, GENDER_LABELS } from "@/lib/userSettings";
import { countAudience } from "./actions";
import { CheckRow, FromTo, Section, WordsInput, toggleIn, type SetField } from "./formParts";

/**
 * The form's "Who sees it" section: the filters, and "Count teachers". The field words are typed as one line
 * (`fieldText`, kept by the form, which splits them on save).
 */
export function AudienceSection({
  form,
  set,
  fieldText,
  onFieldText,
}: {
  form: AnnouncementInput;
  set: SetField;
  fieldText: string;
  onFieldText: (text: string) => void;
}) {
  // The last "Count teachers" answer and the filters it was for (null = couldn't count, e.g. a filter isn't valid).
  const [counted, setCounted] = useState<{ filters: string; count: number | null } | null>(null);
  const [isCounting, startCounting] = useTransition();

  // "Count teachers" runs the matching rule over every account (slow with many teachers), so it's only asked on a
  // click, never while typing. Its answer shows only while the filters are still the ones it counted.
  const filters = JSON.stringify({
    genders: form.genders,
    age_min: form.age_min,
    age_max: form.age_max,
    education_levels: form.education_levels,
    field_words: splitWords(fieldText),
    presentations_min: form.presentations_min,
    presentations_max: form.presentations_max,
    roles: form.roles,
  });
  const countTeachers = () =>
    startCounting(async () => {
      setCounted({ filters, count: await countAudience({ ...NEW_ANNOUNCEMENT, ...JSON.parse(filters) }) });
    });
  const audience = counted?.filters === filters ? counted : null;

  return (
    <Section title="Who sees it">
      <p className="mb-3 text-sm text-text-secondary">
        Empty = everyone. A teacher must fit every filter you fill in; one who hasn&apos;t given that detail doesn&apos;t fit it.
      </p>
      <div className="flex flex-col gap-4">
        <CheckRow
          label="Gender"
          options={GENDERS.map((g) => ({ key: g, label: GENDER_LABELS[g] }))}
          chosen={form.genders}
          onChange={(key, on) => set("genders", toggleIn(form.genders, key, on))}
        />
        <FromTo
          label="Age"
          min={L.ageMin}
          max={L.ageMax}
          from={form.age_min}
          to={form.age_max}
          onFrom={(n) => set("age_min", n)}
          onTo={(n) => set("age_max", n)}
        />
        <CheckRow
          label="Educational background"
          options={EDUCATION_LEVELS.map((level) => ({ key: level, label: EDUCATION_LEVEL_LABELS[level] }))}
          chosen={form.education_levels}
          onChange={(key, on) => set("education_levels", toggleIn(form.education_levels, key, on))}
        />
        <WordsInput
          id="announcement-fields"
          label="Field or major has any of these words"
          value={fieldText}
          onChange={onFieldText}
          placeholder="e.g. English, Filipino"
        />
        <FromTo
          label="Presentations they made"
          min={0}
          max={L.presentationsMax}
          from={form.presentations_min}
          to={form.presentations_max}
          onFrom={(n) => set("presentations_min", n)}
          onTo={(n) => set("presentations_max", n)}
        />
        <CheckRow
          label="Role"
          options={ANNOUNCEMENT_ROLES.map((role) => ({ key: role, label: ROLE_LABELS[role] }))}
          chosen={form.roles}
          onChange={(key, on) => set("roles", toggleIn(form.roles, key, on))}
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-input bg-accent-soft px-3 py-2 text-sm text-text-primary">
        <button
          type="button"
          onClick={countTeachers}
          disabled={isCounting}
          className="inline-flex items-center gap-1.5 rounded-dropdown border border-border-default bg-bg-surface px-3 py-1.5 text-[13px] font-semibold text-text-primary transition-colors hover:bg-bg-page disabled:opacity-60"
        >
          {isCounting && <Spinner size={12} />}
          Count teachers
        </button>
        <span>
          {isCounting ? (
            "Counting… this can take a few seconds."
          ) : !audience ? (
            "See how many accounts these filters match now."
          ) : audience.count === null ? (
            "Can't count yet: check the filters."
          ) : (
            <>
              Matches about <span className="font-semibold">{audience.count.toLocaleString("en-US")}</span>{" "}
              {audience.count === 1 ? "account" : "accounts"} now.
            </>
          )}
        </span>
      </div>
    </Section>
  );
}
