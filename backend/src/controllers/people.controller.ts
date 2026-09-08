import type { Request, Response } from "express";
import { Responder } from "../utils/responder.js";
import * as peopleService from "../services/people.service.js";

const MAX_TASTE_MATCH_LIMIT = 50;

// ?limit= widens the same pipeline for the People Discovery page (larger
// list) while the Home widget's un-parameterized call keeps today's default
// — invalid/missing values fall back to that default rather than erroring,
// since this is just a page-size knob, not caller-supplied data.
function parseLimit(raw: unknown): number {
  const parsed = typeof raw === "string" ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed < 1) return peopleService.COLD_START_MATCH_LIMIT;
  return Math.min(parsed, MAX_TASTE_MATCH_LIMIT);
}

export async function getTasteMatches(req: Request, res: Response): Promise<void> {
  const result = await peopleService.getTasteMatches(req.uid!, parseLimit(req.query.limit));
  Responder.success(res, result);
}

export async function putFollowedCelebrity(req: Request, res: Response): Promise<void> {
  await peopleService.followCelebrity(req.uid!, req.params.personId);
  Responder.noContent(res);
}

export async function deleteFollowedCelebrity(req: Request, res: Response): Promise<void> {
  await peopleService.unfollowCelebrity(req.uid!, req.params.personId);
  Responder.noContent(res);
}

export async function getFollowedCelebrities(req: Request, res: Response): Promise<void> {
  const result = await peopleService.listFollowedCelebrities(req.uid!);
  Responder.success(res, result);
}

export async function getMovieWatchedBy(req: Request, res: Response): Promise<void> {
  const result = await peopleService.getMovieWatchedBy(req.uid!, req.params.movieId);
  Responder.success(res, result);
}

export async function getPeopleSearch(req: Request, res: Response): Promise<void> {
  const result = await peopleService.searchPeopleService(req.query.q);
  Responder.success(res, result);
}

export async function getDiscoverPeople(_req: Request, res: Response): Promise<void> {
  const result = await peopleService.getTopFollowedPeople();
  Responder.success(res, result);
}
