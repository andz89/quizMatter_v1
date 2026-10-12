"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DAYS, GRADES, OTHER_CHOICE, SUBJECTS, TERMS, WEEKS } from "@/lib/schema";
import { SearchField, SearchForm, SearchSelect, SearchTextInput } from "@/components/SearchForm";
import { DEFAULT_SEARCH, homeSearchQuery, LOOK_IN, PAGE_SIZE, parseHomeSearch, SORTS, WITHIN, type HomeSearch } from "../homeSearch";

/** Keyed by the address, so Back puts that page's search back in the box. */
export function HomeSearchForm() {
  const params = useSearchParams();
  const search = parseHomeSearch(Object.fromEntries(params ?? []));
  return <SearchBox key={homeSearchQuery(search)} search={search} />;
}

/**
 * The home page's search box and its options. Enter or Search puts the search in the page link, and the server
 * looks it up in the database (the /search page).
 */
function SearchBox({ search }: { search: HomeSearch }) {
  const router = useRouter();
  const [values, setValues] = useState(search);
  const [isPending, startTransition] = useTransition();
  const set = (change: Partial<HomeSearch>) => setValues({ ...values, ...change });

  return (
    <SearchForm
      query={values.q}
      onQueryChange={(q) => set({ q })}
      placeholder="Search presentations"
      hasOptions={homeSearchQuery({ ...values, q: "" }) !== ""}
      isPending={isPending}
      // The top line and spinner show at once, and stay until the server sends the results.
      onSearch={(q) => startTransition(() => router.push(`/search${homeSearchQuery({ ...values, q, shown: PAGE_SIZE })}`, { scroll: false }))}
      onClear={() => setValues(DEFAULT_SEARCH)}
      className="mx-auto mb-10 max-w-xl"
    >
      <SearchField label="Title">
        <SearchTextInput value={values.title} onChange={(title) => set({ title })} />
      </SearchField>
      <SearchField label="Subject">
        <SearchSelect
          value={values.subject}
          options={[
            { id: "", label: "Any subject" },
            ...SUBJECTS.map((subject) => ({ id: subject, label: subject })),
            { id: OTHER_CHOICE, label: OTHER_CHOICE },
          ]}
          onChange={(subject) => set({ subject })}
        />
      </SearchField>
      <SearchField label="Author">
        <SearchTextInput value={values.author} onChange={(author) => set({ author })} />
      </SearchField>
      <SearchField label="Tags">
        <SearchTextInput value={values.tags} onChange={(tags) => set({ tags })} />
      </SearchField>
      <SearchField label="Includes the words">
        <SearchTextInput value={values.q} onChange={(q) => set({ q })} />
      </SearchField>
      <SearchField label="Doesn't have">
        <SearchTextInput value={values.not} onChange={(not) => set({ not })} />
      </SearchField>
      <SearchField label="Grade">
        <SearchSelect
          value={values.grade}
          options={[
            { id: "", label: "Any grade" },
            ...GRADES.map((grade) => ({ id: grade, label: grade })),
            { id: OTHER_CHOICE, label: OTHER_CHOICE },
          ]}
          onChange={(grade) => set({ grade })}
        />
      </SearchField>
      <SearchField label="Term">
        <SearchSelect
          value={values.term}
          options={[
            { id: "", label: "Any term" },
            ...TERMS.map((term) => ({ id: term, label: term })),
            { id: OTHER_CHOICE, label: OTHER_CHOICE },
          ]}
          onChange={(term) => set({ term })}
        />
      </SearchField>
      <SearchField label="Week">
        <SearchSelect
          value={values.week}
          options={[
            { id: "", label: "Any week" },
            ...WEEKS.map((week) => ({ id: week, label: week })),
            { id: OTHER_CHOICE, label: OTHER_CHOICE },
          ]}
          onChange={(week) => set({ week })}
        />
      </SearchField>
      <SearchField label="Day">
        <SearchSelect
          value={values.day}
          options={[
            { id: "", label: "Any day" },
            ...DAYS.map((day) => ({ id: day, label: day })),
            { id: OTHER_CHOICE, label: OTHER_CHOICE },
          ]}
          onChange={(day) => set({ day })}
        />
      </SearchField>
      <SearchField label="Changed within">
        <SearchSelect value={values.within} options={WITHIN} onChange={(within) => set({ within })} />
      </SearchField>
      <SearchField label="Look in">
        <SearchSelect
          value={values.in}
          options={LOOK_IN}
          onChange={(value) => set({ in: value })}
        />
      </SearchField>
      <SearchField label="Sort by">
        <SearchSelect value={values.sort} options={SORTS} onChange={(sort) => set({ sort })} />
      </SearchField>
    </SearchForm>
  );
}
