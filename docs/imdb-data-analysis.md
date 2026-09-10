# IMDb Data Analysis (Milestone 1)

Analysis of the IMDb dataset available via `bigquery-public-data.imdb`, based on `data/imdb_schema.json` and the sample JSON pulls in `data/`. See [README.md](../README.md) for the full ZATLAN feature list and tech stack, and [docs/hld.md](hld.md) for how this IMDb/BigQuery foundation relates to ZATLAN's own Firestore-backed application data.

**Caveat on method:** this analysis was done from small sample files (10–50 rows per table), not live BigQuery queries — no `bq`/`gcloud` access was available. Structural findings (which columns exist, what a populated row looks like) are reliable. Null-rate/coverage claims are *observations from samples only* and are flagged as such below; they should be confirmed with real aggregate queries before being treated as fact. Suggested queries are included per table so this can be closed out directly in BigQuery.

---

## 1. IMDb Data Analysis

### Tables available

| Table | Columns | Sample file(s) |
|---|---|---|
| `title_basics` | tconst, title_type, primary_title, original_title, is_adult, start_year, end_year, runtime_minutes, genres | `title_basics_start_year_desc.json` |
| `title_ratings` | tconst, average_rating, num_votes | `title_ratings.json` |
| `title_akas` | title_id, ordering, title, region, language, types, attributes, is_original_title | `title_akas.json` |
| `title_crew` | tconst, directors, writers | `title_crew_directors_not_null.json` |
| `title_principals` | tconst, ordering, nconst, category, job, characters | `title_principals.json` |
| `title_episode` | tconst, parent_tconst, season_number, episode_number | `title_episode.json` |
| `name_basics` | nconst, primary_name, birth_year, death_year, primary_profession, known_for_titles | `name_basics.json`, `name_basics_birth_year.json` |
| `reviews` | review, split, label, movie_id, reviewer_rating, movie_url, title, review_embedded (ARRAY<FLOAT64>) | `reviews.json` |

### Structural observations

- IDs join as expected: `title_basics.tconst` ↔ `title_ratings.tconst` ↔ `title_crew.tconst` ↔ `title_principals.tconst` ↔ `title_episode.tconst`/`parent_tconst`; `title_principals.nconst` ↔ `name_basics.nconst`.
- `genres`, `directors`, `writers`, and `known_for_titles` are comma-separated **strings**, not repeated/array fields — need `SPLIT()` in SQL or app-side parsing to treat as multi-valued.
- `reviews.review_embedded` is the one true `ARRAY<FLOAT64>` column — a precomputed text embedding per review, usable directly for vector similarity.
- The `reviews` table does **not** match the standard public IMDb schema (title/crew/principals/ratings/akas/episode). It looks like a separate sentiment-analysis dataset (free-text review + `split` train/test + `label` Positive/Negative + `reviewer_rating` + embedding) joined in for this project, not the official BigQuery IMDb reviews. Critically, **it has no reviewer identity field** — no user id, no reviewer name. It's usable as flavor text or as embedding input for content-based similarity, but must not be presented as reviews written by real/attributable people, since ZATLAN's model is identity-linked social reviews living in Firestore.
- `title_basics_start_year_desc.json` is sorted by `start_year DESC`, so the sample is dominated by unreleased/announced titles (e.g. *Avatar 5*, *Coco 2*, entries dated 2029–2115). Those rows are naturally missing `runtime_minutes`, ratings, and reviews — this is a sampling artifact, not evidence that released titles lack this data.

### Sample-based null observations (unverified at scale — see suggested queries)

| Column | Observed in sample | Suggested verification query |
|---|---|---|
| `title_akas.region` / `.language` | `null` in all 50 sampled rows | `SELECT COUNTIF(region IS NOT NULL) / COUNT(*) FROM title_akas` |
| `name_basics.primary_profession` | `\N` in all rows across two separate samples (plain + birth_year-filtered) | `SELECT COUNTIF(primary_profession != '\\N') / COUNT(*) FROM name_basics` |
| `title_crew.writers` | `null` in all 50 rows, even filtered on `directors IS NOT NULL` | `SELECT COUNTIF(writers IS NOT NULL) / COUNT(*) FROM title_crew` |

If these turn out to be genuinely sparse dataset-wide (not just sample bias), fall back to `title_principals.category` (populated with values like `actor`, `director`, `writer`) to classify people instead of `name_basics.primary_profession`.

---

## 2. Feature/Data Mapping

| README planned feature | Backed by IMDb? | Table(s)/column(s) |
|---|---|---|
| Search movies and series | Yes | `title_basics` (primary_title, title_type, start_year), `title_episode` (season/episode structure for series) |
| Movie information (title, year, runtime, genre) | Partial | `title_basics` — has title/year/runtime/genre, but **no synopsis, poster, or artwork** (see §3) |
| Ratings (IMDb aggregate) | Yes | `title_ratings.average_rating`, `.num_votes` |
| Genre selection | Yes | `title_basics.genres` (comma-separated, needs parsing) |
| Language / Region selection | Column exists, coverage unverified | `title_akas.language`, `.region` — see null-rate caveat above |
| Cast & crew, character names | Yes | `title_principals` (category, characters), `title_crew` (directors; writers sparse in sample), `name_basics` (person details) |
| Likes, Reviews, Watched list, Watchlist | No — by design | Entirely ZATLAN-generated, lives in Firestore — see [docs/hld.md](hld.md)'s data strategy |
| Personalized recommendations (content-based) | Partial | Genre/cast/crew/rating signals from `title_basics`/`title_principals`/`title_ratings`; `reviews.review_embedded` vectors usable for content-similarity, but not tied to ZATLAN users |
| Streaming Availability | **No** | No table in this schema has platform/provider data — see §3 |
| User Profiles, Privacy prefs | No — by design | Firestore |
| People Discovery (who watched a movie, similar tastes) | No — by design | `name_basics`/`title_principals` only describe cast/crew, not viewers; this feature is 100% Firestore social-graph data |
| Events / Watch Parties | No — by design | Firestore |
| Persistent Movie Rooms | No — by design | Firestore |
| Location-Based Discovery | No — by design | Firestore + Google Maps, no IMDb geo data exists |
| Forums / Communities | No — by design | Firestore |

"No — by design" rows are not gaps: the README's own Data Strategy section already scopes these as ZATLAN-generated application data, and the sample data confirms there's nothing in IMDb that could substitute for them anyway.

---

## 3. Missing Data Identification

1. **Streaming availability — zero data.** No table anywhere in this schema carries platform/provider info. This is planned Feature #2 in the README with nothing behind it. Needs an external source (e.g. TMDB `/watch/providers`, JustWatch), joinable via IMDb ID.
2. **No synopsis/plot text, no poster art, no cast photos.** `title_basics` covers title/genre/year/runtime only. "Movie information" as a feature can't ship on IMDb data alone. TMDB covers this same gap as #1 (title/movie objects there carry an `imdb_id` field for joining against `tconst`).
3. **Region/language coverage unverified at scale** (`title_akas`) — see §1 table and suggested query. Needed before committing to "Region/Language selection" as an MVP feature.
4. **`name_basics.primary_profession` coverage unverified at scale** — see §1. Fallback: `title_principals.category`.
5. **`title_crew.writers` coverage unverified at scale** — sample shows entirely absent even where directors are present.
6. **No ZATLAN-attributable reviewer identity in the `reviews` table** — usable for content-based signals (embeddings) or flavor text only, not as a stand-in for real user reviews.

### Next step

User is checking whether the BigQuery project also has TMDB data available. If so, that would directly close gaps #1 and #2 above (streaming availability + synopsis/poster/cast photos), since TMDB natively carries both and cross-references IMDb IDs. This doc should be updated with a TMDB section once that's confirmed.
