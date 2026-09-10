// Bulk-seeds the local search index (hld.md §18) with a broad slice of
// well-known movies, so GET /search/movies has real local coverage from day
// one instead of only containing whatever's been incidentally viewed or
// searched already. Pulls TMDB's `/movie/popular` list, paginated, and
// writes each into movies/{movieId} with its computed titleSearchTerms
// (searchIndex.ts) via merge — never overwrites a movie that's already been
// fully detail-ingested, just adds/refreshes the search-index fields.
//
// Same "run manually for now" shortcut as computeTasteMatches.ts and
// refreshRecentMovies.ts — a real Cloud Scheduler job (re-seeding weekly,
// say) is the eventual upgrade path once there's traffic to justify it.
//
// Run manually for now: pnpm --filter zatlan-backend run seed-search-catalog [pages]
// Defaults to 25 pages (~500 movies) if no page count is given.

import { requireDb } from "../src/lib/firebaseAdmin.js";
import { getPopularMovies } from "../src/lib/tmdb.js";
import { buildSearchTerms } from "../src/lib/searchIndex.js";
import { pathToFileURL } from "node:url";

const DEFAULT_PAGES = 25;
// Firestore's per-batch write cap is 500 *operations*, but there's a separate
// ~10 MiB per-batch *payload* cap that bites first here: titleSearchTerms can
// run to several hundred variant strings per movie (searchIndex.ts's typo
// variants alone are ~27x a word's length), so 400 docs/batch (sized only for
// the operation cap) was enough to blow past the payload cap in practice —
// hit live running this script. 50 keeps real headroom under either limit.
const BATCH_SIZE = 50;

async function main() {
  const db = requireDb();
  const pages = Number(process.argv[2]) || DEFAULT_PAGES;

  const movies = await getPopularMovies(pages);
  console.log(`Fetched ${movies.length} popular movies across ${pages} page(s). Writing to Firestore...`);

  // set({merge:true}) is idempotent, so re-running this script after a
  // partial failure is safe — already-written movies just get rewritten
  // with the same data, nothing duplicates.
  let written = 0;
  for (let i = 0; i < movies.length; i += BATCH_SIZE) {
    const chunk = movies.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const movie of chunk) {
      batch.set(
        db.collection("movies").doc(movie.movieId),
        { title: movie.title, poster: movie.poster, year: movie.year, titleSearchTerms: buildSearchTerms(movie.title) },
        { merge: true }
      );
    }
    await batch.commit();
    written += chunk.length;
    console.log(`  ${written}/${movies.length} written...`);
  }

  console.log(`Seeded search index for ${movies.length} movies.`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
