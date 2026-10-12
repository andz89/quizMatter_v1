# Home Page Groups as Their Own Pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the home page's five tabs into their own pages under one shared layout, and move search to its own `/search` page with one mixed list and "Show more".

**Architecture:** A Next.js route group `src/app/(home)/` holds a shared server layout (heading, New presentation, search box, tab row with counts) and one server page per group, each loading only its own data through shared helpers in `(home)/cards.ts`. Client parts are split by page; the shared card grid and bookmark state live in `(home)/CardGrid.tsx`. "Show more" is a link that adds `shown=N` to the address.

**Tech Stack:** Next.js 16 App Router (route groups, layouts, `usePathname`, `useSearchParams`), Supabase JS (PostgREST), zod, dnd-kit (unchanged), Lucide.

**Spec:** `docs/superpowers/specs/2026-10-12-home-group-pages-design.md`

## Global Constraints

- Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md` and `route-groups.md` before Task 3 (CLAUDE.md: this Next.js differs). Layouts don't re-render on navigation: the tab row uses `usePathname`, the search box `useSearchParams`.
- No database change, no new package. Design-system classes only; Lucide icons with `size`; the one `Spinner`; the one `TopLoadingBar` / `LinkPending`.
- Behavior of cards, bookmarks, Present, folders, drag and drop, subject rows and My reviews stays as today: code is **moved**, not rewritten, unless a step says otherwise.
- No test runner: every task's gate is `npx next typegen` (route types for `PageProps`), `npx tsc --noEmit`, `npx eslint <changed files>`.
- Page size: `PAGE_SIZE = 20`; `shown` is a multiple of 20, from 20 to 500.

## Review Focus

1. A bookmark click on any page → the card's bookmark flips at once and the "Saved" tab count updates (via `router.refresh()`); on `/saved` the card disappears. Task 2 (`SavableCards`).
2. Old link `/?q=fractions&grade=Grade+3` → lands on `/search?q=fractions&grade=Grade+3` with the same results. Task 3 (`/` redirect).
3. A non-editor opens `/reviews` → sent to `/`; the "My reviews" tab isn't shown. Task 5.
4. `/search?shown=999` or `shown=abc` → falls back to 20, no error. Task 1 (`shownSchema`).
5. Back after "Show more" or after a search → the search box shows that page's search (form keyed by the address). Task 2 (`HomeSearchForm`).

---

### Task 1: Search options and shared server helpers

**Files:**
- Modify: `src/app/homeSearch.ts`
- Create: `src/app/(home)/cards.ts`

**Interfaces — Produces:**
- `homeSearch.ts`: `LOOK_IN` = all / quizmatter / teachers / mine; `HomeSearch` gains `shown: number`; `PAGE_SIZE = 20`; `shownSchema`; `parseShown(params): number`.
- `cards.ts`: `CARD_COLUMNS`, `type CardPresentation`, `type SavedPresentation`, `toCard(p, href, now)`, `myCard(p, isAdmin, now)`, `draftCard(draft, now)`, `loadCardContext(supabase, rows, myId) → { savedIds: Set<string>; toSavableCard(p): PresentationCardData }`, `applySearch(query, search)`, `orderBy(query, sort)`, `draftMatches(draft, search, since)`, `myId(supabase)`.

- [ ] **Step 1: homeSearch.ts.** Replace `LOOK_IN` with:

```ts
// Where /search looks. "All": every presentation shared with me (QuizMatter's and other teachers'), not my own.
export const LOOK_IN = [
  { id: "all", label: "All shared" },
  { id: "quizmatter", label: "From QuizMatter" },
  { id: "teachers", label: "Other teachers" },
  { id: "mine", label: "Mine" },
] as const;
```

Add after `SORTS`:

```ts
// Cards per "Show more" step (search results and Other teachers).
export const PAGE_SIZE = 20;
// How many cards are shown: 20, 40, 60… at most 500. Anything else falls back to 20.
export const shownSchema = z.coerce.number().int().min(PAGE_SIZE).max(500).multipleOf(PAGE_SIZE).catch(PAGE_SIZE);
export function parseShown(params: Record<string, string | string[] | undefined>): number {
  return shownSchema.parse(firstValues(params).shown);
}
```

In `homeSearchSchema` add `shown: shownSchema,` (the `in` enum already reads from `LOOK_IN`, so old `in=saved` / `in=reviewed` fall back to `"all"`). `searchQuery` already skips defaults, so `shown=20` stays out of links.

- [ ] **Step 2: cards.ts.** Move from `src/app/page.tsx`, unchanged: `CARD_COLUMNS`, `CardPresentation`, `SavedPresentation`, `toCard`, `draftMatches`, `inList`; and the search filters from `load()` (lines 81–100) into:

```ts
/** Every search option as filters on a presentations query (Look in, Sort and Show more are applied elsewhere). */
export function applySearch<Q extends PresentationQuery>(query: Q, search: HomeSearch): Q {
  // …lines 84–100 of today's page.tsx, unchanged, ending with the `since` filter…
  return query;
}

/** The search's Sort, plus each card's first slide only. */
export function orderBy<Q extends PresentationQuery>(query: Q, sort: HomeSearch["sort"]): Q {
  return query
    .order(sort === "title" ? "title" : sort === "newest" ? "created_at" : "updated_at", { ascending: sort === "title" })
    .order("position", { referencedTable: "first_slide" })
    .limit(1, { referencedTable: "first_slide" }) as Q;
}
```

(`PresentationQuery` = `ReturnType<ReturnType<SupabaseClient["from"]>["select"]>`; if tsc can't infer it, type the param as `any` with an eslint-disable line and a comment — PostgREST builder generics are deep.)

Also add:

```ts
/** The logged-in teacher's id ("" if none). */
export async function myId(supabase: SupabaseClient): Promise<string> {
  const { data } = await supabase.auth.getClaims();
  return data?.claims.sub ?? "";
}

/** My own presentation as a card: opens the editor; shows Published / Hidden. */
export function myCard(p: CardPresentation, isAdmin: boolean, now: number) {
  return {
    ...toCard(p, `/presentation/${p.id}/edit`, now),
    badge: p.hidden_at ? ("hidden" as const) : p.is_published ? ("published" as const) : undefined,
    canMoveToQuizMatter: isAdmin,
    createdAt: Date.parse(p.created_at),
    updatedAt: Date.parse(p.updated_at),
  };
}

/** One of Claude's drafts (not saved yet) as a card. */
export function draftCard(draft: DraftSummary, now: number) {
  // …body of today's page.tsx lines 306–317 (the drafts .map), unchanged…
}

/**
 * What cards of other people's presentations need: which ones I saved (bookmark), and the publisher's name for
 * other teachers' ones. `toSavableCard` is today's page.tsx lines 329–340.
 */
export async function loadCardContext(supabase: SupabaseClient, rows: CardPresentation[], me: string) {
  const [savedRows, publisherNames] = await Promise.all([
    supabase.from("saved_presentations").select("presentation_id"),
    loadPublisherNames(supabase, rows.filter((p) => !p.from_admin).map((p) => p.owner_id)),
  ]);
  if (savedRows.error) throw savedRows.error;
  const savedIds = new Set(savedRows.data.map((row) => row.presentation_id));
  const now = Date.now();
  const toSavableCard = (p: CardPresentation): PresentationCardData => ({ /* lines 330–339, with now, savedIds, me */ });
  return { savedIds, toSavableCard };
}
```

- [ ] **Step 3:** `npx tsc --noEmit` — `page.tsx` still compiles (it keeps its own copies until Task 3). Lint `cards.ts`, `homeSearch.ts`. Fix the `LOOK_IN` users in `PresentationHome.tsx` only if tsc requires (it's deleted in Task 3).
- [ ] **Step 4: Commit** `"Home: shared card helpers and search options for separate pages"`.

### Task 2: Shared client parts

**Files:**
- Create: `src/app/(home)/CardGrid.tsx`, `src/app/(home)/ShowMore.tsx`, `src/app/(home)/HomeTabs.tsx`, `src/app/(home)/HomeSearchForm.tsx`

**Interfaces — Produces:** `Cards` (today's, unchanged props), `Empty`, `PartLabel`, `SavableCards({ cards, empty, removeOnUnsave? })`, `ShowMore({ shown, total })`, `HomeTabs({ counts, isEditor })` with `type HomeTab = "mine" | "quizmatter" | "reviewed" | "saved" | "teachers"`, `HomeSearchForm()`.

- [ ] **Step 1: CardGrid.tsx** (`"use client"`): move `Cards`, `Empty`, `PartLabel` from `PresentationHome.tsx` unchanged (export them). Add:

```tsx
/**
 * Other people's presentations with working bookmarks. A click flips the bookmark here at once, then
 * router.refresh() updates the tab counts in the layout. `removeOnUnsave`: the Saved page drops the card.
 */
export function SavableCards({ cards, empty, removeOnUnsave = false }: { cards: PresentationCardData[]; empty: string; removeOnUnsave?: boolean }) {
  const router = useRouter();
  const [savedIds, setSavedIds] = useState(() => new Set(cards.filter((card) => card.isSaved).map((card) => card.id)));
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());
  const onSavedChange = (card: PresentationCardData, isSaved: boolean) => {
    setSavedIds((ids) => {
      const next = new Set(ids);
      if (isSaved) next.add(card.id);
      else next.delete(card.id);
      return next;
    });
    if (removeOnUnsave && !isSaved) setRemovedIds((ids) => new Set(ids).add(card.id));
    router.refresh();
  };
  return <Cards cards={cards.filter((card) => !removedIds.has(card.id))} empty={empty} savedIds={savedIds} onSavedChange={onSavedChange} />;
}
```

- [ ] **Step 2: ShowMore.tsx** (`"use client"`):

```tsx
/** "Show more": the same page with 20 more cards (`shown` in the link), keeping the scroll. Hidden once all show. */
export function ShowMore({ shown, total }: { shown: number; total: number }) {
  const pathname = usePathname();
  const params = useSearchParams();
  if (shown >= total) return null;
  const next = new URLSearchParams(params);
  next.set("shown", String(shown + PAGE_SIZE));
  return (
    <div className="mt-6 flex flex-col items-center gap-2">
      <Link href={`${pathname}?${next}`} scroll={false} className="rounded-button border border-border-default bg-bg-surface px-4 py-2 text-sm font-semibold text-text-primary hover:bg-bg-page flex items-center gap-2">
        Show more
        <LinkPending spinner />
      </Link>
      <p className="text-[13px] text-text-secondary">Showing {shown} of {total}</p>
    </div>
  );
}
```

(Check `LinkPending`'s prop name for the Spinner in `src/components/LinkPending.tsx` and use it.)

- [ ] **Step 3: HomeTabs.tsx** (`"use client"`): today's tab row and `TabMenu`, with `<Link href>` + `<LinkPending />` instead of buttons, the open tab from `usePathname()`:

```tsx
export type HomeTab = "mine" | "quizmatter" | "reviewed" | "saved" | "teachers";
const TABS: { id: HomeTab; label: string; href: string }[] = [
  { id: "mine", label: "My presentations", href: "/" },
  { id: "quizmatter", label: "From QuizMatter", href: "/quizmatter" },
  // Editors only.
  { id: "reviewed", label: "My reviews", href: "/reviews" },
  { id: "saved", label: "Saved", href: "/saved" },
  { id: "teachers", label: "Other teachers", href: "/teachers" },
];
```

`HomeTabs({ counts, isEditor })`: `const picked = TABS.find((tab) => tab.href === pathname)?.id` (none on `/search`). Desktop row = today's lines 255–277 with `Link` (`role="tab"` → plain links with `aria-current="page"` on the picked one). Phones = today's `TabMenu` (lines 591–660) with `Link` items that close the menu on click; its button label is the picked tab's name, or "Search results" on `/search`.

- [ ] **Step 4: HomeSearchForm.tsx** (`"use client"`): today's `HomeSearchForm` (lines 430–526) with these changes: no props; `const params = useSearchParams(); const search = parseHomeSearch(Object.fromEntries(params));` and the form keyed by the caller; push to `/search${homeSearchQuery({ ...values, q, shown: PAGE_SIZE })}`; "Look in" options = `LOOK_IN` (no editor filter). Wrap the export:

```tsx
/** Keyed by the address, so Back puts that page's search back in the box. */
export function HomeSearchForm() {
  const params = useSearchParams();
  const search = parseHomeSearch(Object.fromEntries(params));
  return <SearchBox key={homeSearchQuery(search)} search={search} />;
}
```

- [ ] **Step 5:** tsc + lint the four files. **Commit** `"Home: shared card grid, Show more, tab links and search box"`.

### Task 3: Layout, loading and My presentations (`/`)

**Files:**
- Create: `src/app/(home)/layout.tsx`, `src/app/(home)/loading.tsx`, `src/app/(home)/page.tsx`, `src/app/(home)/MyPresentations.tsx`
- Delete: `src/app/page.tsx`, `src/app/PresentationHome.tsx`

- [ ] **Step 1:** Read the two Next.js docs named in Global Constraints.
- [ ] **Step 2: layout.tsx** (server):

```tsx
export default async function HomeLayout({ children }: { children: ReactNode }) {
  const account = await getAccount();
  // Banned (Admin → Teachers): every home page only says so, until Supabase's ban ends their login (see proxy.ts).
  if (account.isBanned) return <BlockedHome />;
  const supabase = await createClient();
  const me = await myId(supabase);
  const counts = await loadTabCounts(supabase, me, account.isEditor);
  return (
    <>
      <NavBar />
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">
        {/* today's header, lines 176–182 */}
        <Suspense>
          <HomeSearchForm />
        </Suspense>
        <HomeTabs counts={counts} isEditor={account.isEditor} />
        {children}
      </main>
    </>
  );
}
```

`BlockedHome` moves here unchanged. `loadTabCounts` (in this file): count-only queries (`select("id", { count: "exact", head: true })`) with today's section filters for mine (`owner_id = me`, `from_admin = false`), quizmatter, teachers, saved (`select("id, saved_presentations!inner(presentation_id)", { count: "exact", head: true })` + saved filters); for editors, reviewed = size of the set of reviewed presentation ids (`select("id, presentation_reviewers!inner(reviewer_id)")` filtered as today) united with `rpc("my_reviews")` ids (today's line 122). Drafts aren't counted (no D1 call on every page).

- [ ] **Step 3: loading.tsx** — the same as `src/app/account/loading.tsx` (TopLoadingBar + Spinner), comment "Shown while a home page loads."; one file covers every page in the group.
- [ ] **Step 4: page.tsx** (`/`): if the link has search options (`homeSearchQuery(parseHomeSearch(params)) !== ""`) → `redirect(\`/search${…}\`)` (old links). Else load in parallel: my presentations (`CARD_COLUMNS`, owner = me, not from_admin, `orderBy(…, "updated")`), drafts (`account.isAdmin ? [] : listDrafts(account.id)`), folders, folder_items, and the savedIds is not needed (my own cards have no bookmark). Build `myCards` (`myCard` + `draftCard`, drafts not already saved, sorted by updatedAt desc) with `folderId`, folders with counts (today's lines 187–191), render `<MyPresentations myCards folders />`.
- [ ] **Step 5: MyPresentations.tsx** (`"use client"`): today's PresentationHome state and JSX for the `mine` tab only — folders, open folder, select mode, drag and drop (lines 145–210), "See all" link (280–284), FolderHeader, SubjectChips, SelectRow, Cards, FolderTiles, MoveToFolderModal, `PresentationView` when presenting, DragOverlay — without the `isSearching` branches (search is on `/search` now). `SubjectChips` and `subjectChip` move to `CardGrid.tsx` (exported) since `/quizmatter` uses them too. Keep `MY_ROW_SIZE = 5` here.
- [ ] **Step 6:** Delete `src/app/page.tsx` and `src/app/PresentationHome.tsx`. `npx next typegen`, tsc, lint. **Commit** `"Home: shared layout, and My presentations on its own page"`.

### Task 4: From QuizMatter (`/quizmatter`)

**Files:** Create `src/app/(home)/quizmatter/page.tsx`, `src/app/(home)/quizmatter/QuizMatterPresentations.tsx`

- [ ] **Step 1: page.tsx:** load QuizMatter rows (published, not hidden, from_admin; `orderBy(…, "updated")`), `loadCardContext`, cards = `{ ...toSavableCard(p), createdAt, updatedAt }`; render `<QuizMatterPresentations cards />`.
- [ ] **Step 2: QuizMatterPresentations.tsx** (`"use client"`): today's `adminSort` + `ADMIN_SORTS` buttons (lines 285–301), `SubjectChips`, `SubjectGroups` (lines 703–741, moved here), the subject's `Cards`, `PresentationView` when presenting; bookmarks through the same state as `SavableCards` (savedIds + `router.refresh()`). `AdminCardData` type moves here.
- [ ] **Step 3:** typegen, tsc, lint. **Commit** `"Home: From QuizMatter on its own page"`.

### Task 5: My reviews (`/reviews`) and Saved (`/saved`)

**Files:** Create `src/app/(home)/reviews/page.tsx`, `src/app/(home)/saved/page.tsx`

- [ ] **Step 1: reviews/page.tsx:** `if (!account.isEditor) redirect("/")`. Load `rpc("my_reviews")` and the reviewed rows (today's `reviewed` section + `orderBy(…, "updated")`), `loadCardContext`. Render today's lines 377–404 without the `isSearching` parts: "In progress" + `ReviewRows`, "Canceled" + `ReviewRows`, "Published" + `<SavableCards>`, or `<Empty>You haven't reviewed any presentations yet.</Empty>`. `PresentationView` isn't needed (cards here open their page).
- [ ] **Step 2: saved/page.tsx:** load every saved row (today's `saved` section, no id limit — at most `MAX_SAVED`), sort by `saved_at` newest first (today's `savedTime`), `loadCardContext`, render `<SavableCards cards empty="You haven't saved any presentations yet." removeOnUnsave />`.
- [ ] **Step 3:** typegen, tsc, lint. **Commit** `"Home: My reviews and Saved on their own pages"`.

### Task 6: Other teachers (`/teachers`)

**Files:** Create `src/app/(home)/teachers/page.tsx`

- [ ] **Step 1:** `const shown = parseShown(await searchParams);` load the teachers section with `{ count: "exact" }`, `orderBy(…, "updated")`, `.range(0, shown - 1)`; `loadCardContext`; render `<SavableCards cards empty="No other teacher has published a presentation yet." />` and `<ShowMore shown={shown} total={count ?? 0} />` (in `<Suspense>`, it reads the address).
- [ ] **Step 2:** Confirm `src/app/teachers/[slug]` still builds (`npx next typegen` lists both routes). tsc, lint. **Commit** `"Home: Other teachers on its own page, 20 at a time"`.

### Task 7: Search (`/search`)

**Files:** Create `src/app/(home)/search/page.tsx`

- [ ] **Step 1:** `const search = parseHomeSearch(await searchParams)`, `since = changedSince(search)`, `me`. Base query by Look in, with `{ count: "exact" }`:

```ts
const base = supabase.from("presentations").select(CARD_COLUMNS, { count: "exact" });
const query =
  search.in === "mine" ? base.eq("owner_id", me).eq("from_admin", false)
  : search.in === "quizmatter" ? base.eq("is_published", true).is("hidden_at", null).eq("from_admin", true)
  : search.in === "teachers" ? base.eq("is_published", true).is("hidden_at", null).eq("from_admin", false).neq("owner_id", me)
  // All shared: QuizMatter's and other teachers' (my own aren't in it, so my copies don't sit next to the originals).
  : base.eq("is_published", true).is("hidden_at", null).or(`from_admin.eq.true,owner_id.neq.${me}`);
const { data, count, error } = await orderBy(applySearch(query, search), search.sort).range(0, search.shown - 1);
```

Mine: drafts matching (`draftMatches`) go first as `draftCard`s (not paged; few). Cards: Mine → `myCard`; others → `toSavableCard`. Total = `count + drafts`.

- [ ] **Step 2:** Render: heading `Results for “q”` or `Search results`, then the total (`42 results`), "Clear search" link to `/` (today's lines 236–250 plus the total); Mine → `<Cards>` (from CardGrid, no menu, no bookmarks) inside a small client wrapper only if tsc needs one, else `<SavableCards>`; `<Empty>No presentations match your search.</Empty>` when none; `<ShowMore shown={search.shown} total={total} />` in `<Suspense>`; `PresentationView` isn't needed.
- [ ] **Step 3:** typegen, tsc, lint. **Commit** `"Home: search on its own page, one mixed list, 20 at a time"`.

### Task 8: Final check

- [ ] Update CLAUDE.md "Presentation Reviews" line about `PresentationHome.tsx` → the `/reviews` page (`src/app/(home)/reviews/page.tsx`).
- [ ] `npx next typegen`, `npx tsc --noEmit`, `npx eslint src`; grep for leftovers: `PresentationHome`, `isSearching`, `"reviewed"` in LOOK_IN.
- [ ] `git diff` read against the spec. **Commit** `"Docs: home pages"`.
