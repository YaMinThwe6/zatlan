// Computes "people with similar movie taste" (hld.md §5b) and writes the top
// matches per user to users/{uid}/tasteMatches/{matchedUid}.
//
// hld.md §5b's documented design routes this through a daily BigQuery batch job,
// since comparing every user against every other user doesn't scale as a live
// Firestore query. At today's handful-of-test-users scale that comparison is
// trivial directly against Firestore — see the implementation note added to
// hld.md §5b. Swap in the real cron + BigQuery pipeline once there's enough
// users to matter; this script implements the same algorithm either way.
//
// Run manually for now: pnpm --filter zatlan-backend exec tsx scripts/computeTasteMatches.ts

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { pathToFileURL } from "node:url";

const TOP_N = 10;

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

async function main() {
  const app = initializeApp({
    credential: cert(process.env.GOOGLE_APPLICATION_CREDENTIALS as string),
    projectId: process.env.FIREBASE_PROJECT_ID
  });
  const db = getFirestore(app);

  const usersSnap = await db.collection("users").get();
  const uids = usersSnap.docs.map((d) => d.id);

  const watchedMovies = new Map<string, Set<string>>();
  const watchedGenres = new Map<string, Set<string>>();

  for (const uid of uids) {
    const watchedSnap = await db.collection("users").doc(uid).collection("watched").get();
    const movieIds = watchedSnap.docs.map((d) => d.id);
    watchedMovies.set(uid, new Set(movieIds));

    const genres = new Set<string>();
    for (const movieId of movieIds) {
      const movieSnap = await db.collection("movies").doc(movieId).get();
      for (const g of (movieSnap.data()?.genres as string[] | undefined) ?? []) genres.add(g);
    }
    watchedGenres.set(uid, genres);
  }

  const scores = new Map<string, Map<string, number>>();
  for (const uid of uids) scores.set(uid, new Map());

  for (let i = 0; i < uids.length; i++) {
    for (let j = i + 1; j < uids.length; j++) {
      const a = uids[i];
      const b = uids[j];
      const moviesScore = jaccard(watchedMovies.get(a)!, watchedMovies.get(b)!);
      const genresScore = jaccard(watchedGenres.get(a)!, watchedGenres.get(b)!);
      const combined = moviesScore * 0.7 + genresScore * 0.3;
      if (combined <= 0) continue;
      scores.get(a)!.set(b, combined);
      scores.get(b)!.set(a, combined);
    }
  }

  let written = 0;
  for (const uid of uids) {
    const pairScores = [...scores.get(uid)!.entries()].sort((x, y) => y[1] - x[1]).slice(0, TOP_N);
    const batch = db.batch();
    for (const [matchedUid, score] of pairScores) {
      const ref = db.collection("users").doc(uid).collection("tasteMatches").doc(matchedUid);
      batch.set(ref, { score: Math.round(score * 100), computedAt: new Date() });
      written++;
    }
    if (pairScores.length > 0) await batch.commit();
  }

  console.log(`Computed taste matches for ${uids.length} users, wrote ${written} match documents.`);
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
