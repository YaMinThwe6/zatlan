import type { TasteMatch } from '../features/home/services/homeApi'

function connectLabel(relationship: TasteMatch['relationship']): string {
  if (relationship === 'following') return 'Following'
  if (relationship === 'pending') return 'Requested'
  return 'Connect'
}

// Readable text for the People Discovery page's detailed card — the compact
// card (Home's rail widget) only ever shows the bare score, never this.
function matchReasonLabel(reason: TasteMatch['matchReason']): string {
  switch (reason) {
    case 'tasteMatch':
      return 'Similar taste in movies'
    case 'genreOverlap':
      return 'Shares your favorite genres'
    case 'languageOverlap':
      return 'Watches movies in a language you like'
    case 'suggested':
      return 'Suggested for you'
  }
}

const MAX_GENRE_TAGS = 3

interface Props {
  person: TasteMatch
  onOpenProfile: (uid: string) => void
  onToggleConnect: (uid: string) => void
  // The People Discovery page's richer card — matchReason spelled out,
  // favorite-genre tags, follower count. Home's rail widget renders the same
  // component without this and gets the original compact tile/row.
  detailed?: boolean
}

// Extracted from PeopleYouMightVibeWith so the Home widget and the /people
// discovery page render suggestions from one component. The horizontal-
// scroll compact-tile layout (<lg) vs. right-rail row layout (lg+) is a pure
// CSS breakpoint switch baked into this one markup, same as it was inline
// before. `detailed` only ever applies on top of the lg+ row layout — the
// Discovery page never renders at the Home widget's cramped compact width.
export function PersonSuggestionCard({ person, onOpenProfile, onToggleConnect, detailed = false }: Props) {
  const isConnected = person.relationship !== 'none'
  // Defensive against an older cached TasteMatch response missing these
  // fields (added after the initial People Discovery ship) — never crash the
  // whole list over one person's stale shape.
  const favoriteGenres = person.favoriteGenres ?? []
  const followerCount = person.followerCount ?? 0

  return (
    <li className="w-[118px] flex-none rounded-2xl border border-border-soft bg-surface p-4 text-center lg:flex lg:w-full lg:items-center lg:gap-2.5 lg:rounded-none lg:border-none lg:bg-transparent lg:p-0 lg:text-left">
      <button
        type="button"
        onClick={() => onOpenProfile(person.uid)}
        className="flex w-full flex-col items-center lg:min-w-0 lg:flex-1 lg:flex-row lg:text-left"
      >
        <div className="mx-auto flex h-13 w-13 items-center justify-center rounded-full border border-[rgba(124,140,166,0.32)] bg-[rgba(124,140,166,0.14)] text-[15px] font-bold text-[#9BABC4] lg:mx-0 lg:h-9.5 lg:w-9.5 lg:flex-none lg:text-[13px]">
          {person.displayName.charAt(0).toUpperCase()}
        </div>
        <div className="mt-2.5 text-[12.5px] font-bold text-text lg:hidden">{person.displayName}</div>
        <div className="hidden min-w-0 lg:ml-2.5 lg:block">
          <div className="truncate text-[12.5px] font-bold text-text">{person.displayName}</div>
          {detailed ? (
            <>
              <div className="mt-0.5 text-[11px] font-semibold text-accent">
                {person.score}% match · {matchReasonLabel(person.matchReason)}
              </div>
              {favoriteGenres.length > 0 && (
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {favoriteGenres.slice(0, MAX_GENRE_TAGS).map((genre) => (
                    <li key={genre} className="rounded-md bg-[rgba(155,171,196,0.14)] px-2 py-0.5 text-[10px] font-semibold text-[#9BABC4]">
                      {genre}
                    </li>
                  ))}
                </ul>
              )}
              {followerCount > 0 && (
                <div className="mt-1.5 text-[10.5px] text-text-muted">
                  {followerCount} follower{followerCount === 1 ? '' : 's'}
                </div>
              )}
            </>
          ) : (
            <div className="text-[10.5px] font-semibold text-accent">{person.score}% taste match</div>
          )}
        </div>
      </button>
      <div className="mt-0.5 text-[10.5px] font-bold text-accent lg:hidden">{person.score}% match</div>
      <button
        type="button"
        onClick={() => onToggleConnect(person.uid)}
        className={
          isConnected
            ? 'mt-2.5 w-full rounded-[9px] border border-border bg-surface-alt py-1.5 text-[11px] font-bold text-text lg:mt-0 lg:w-auto lg:flex-none lg:px-3.5 lg:py-1.5'
            : 'mt-2.5 w-full rounded-[9px] border border-accent bg-transparent py-1.5 text-[11px] font-bold text-accent lg:mt-0 lg:w-auto lg:flex-none lg:px-3.5 lg:py-1.5'
        }
      >
        {connectLabel(person.relationship)}
      </button>
    </li>
  )
}
