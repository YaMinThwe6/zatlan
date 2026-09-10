// Refreshes the cached "recently released" movies list backing GET
// /movies/recent (api-contracts.md §1) — written to discover/recentMovies
// so that endpoint reads from Firestore instead of hitting TMDB live on
// every single request. hld.md §18 already documents that this endpoint
// (and search) shortcut past its own "search must never depend on TMDB
// live" design for the prototype's timeline; this script is the missing
// other half of that shortcut — cached, refreshed periodically, rather
// than either "always live" or a real ingestion pipeline.
//
// Same "run manually for now" shortcut as computeTasteMatches.ts: a real
// Cloud Scheduler job is the eventual upgrade path once there's enough
// traffic to justify standing it up — this script implements the exact
// same write either way, so swapping the trigger later is infra, not logic.
//
// Run manually for now: pnpm --filter zatlan-backend run refresh-recent-movies

import { requireDb } from "../src/lib/firebaseAdmin.js";
import { getRecentMovies } from "../src/lib/tmdb.js";
import { buildSearchTerms } from "../src/lib/searchIndex.js";
import { pathToFileURL } from "node:url";

async function main() {
  const db = requireDb();
  const items = await getRecentMovies();
  await db.collection("discover").doc("recentMovies").set({ items, updatedAt: new Date() });

  // Also upsert each into movies/{movieId} with its search-index terms, so a
  // recently-released title is immediately searchable (hld.md §18) rather
  // than only appearing in the "recently released" section until someone
  // happens to search or open it first.
  if (items.length > 0) {
    const batch = db.batch();
    for (const item of items) {
      batch.set(
        db.collection("movies").doc(item.movieId),
        { title: item.title, poster: item.poster, year: item.year, titleSearchTerms: buildSearchTerms(item.title) },
        { merge: true }
      );
    }
    await batch.commit();
  }

  console.log(`Refreshed recently-released movies cache: ${items.length} items (also indexed for search).`);
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
