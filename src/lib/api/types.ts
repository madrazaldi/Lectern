// Shapes returned by the Audiobookshelf server (v2.2x+). Only the fields Lectern reads are typed.

export type MediaType = 'book' | 'podcast';

export interface Library {
  id: string;
  name: string;
  mediaType: MediaType;
  icon: string;
  displayOrder: number;
  settings: { coverAspectRatio: number; hideSingleBookSeries?: boolean };
}

export interface Chapter {
  id: number;
  start: number;
  end: number;
  title: string;
}

export interface AuthorRef {
  id: string;
  name: string;
}

export interface SeriesRef {
  id: string;
  name: string;
  sequence: string | null;
}

export interface BookMetadata {
  title: string;
  subtitle: string | null;
  authorName?: string;
  narratorName?: string;
  seriesName?: string;
  authors?: AuthorRef[];
  narrators?: string[];
  series?: SeriesRef[] | SeriesRef;
  genres: string[];
  publishedYear: string | null;
  publisher: string | null;
  description: string | null;
  descriptionPlain?: string;
  language: string | null;
  explicit: boolean;
  abridged?: boolean;
  isbn?: string | null;
  asin?: string | null;
}

export interface PodcastMetadata {
  title: string;
  author: string | null;
  description: string | null;
  descriptionPlain?: string;
  releaseDate: string | null;
  genres: string[];
  feedUrl: string | null;
  imageUrl: string | null;
  language: string | null;
  explicit: boolean;
}

export interface AudioTrack {
  index: number;
  startOffset: number;
  duration: number;
  title: string;
  contentUrl: string;
  mimeType: string;
  codec?: string;
}

export interface AudioFile {
  index: number;
  ino: string;
  duration: number;
  bitRate: number;
  codec: string;
  mimeType: string;
  exclude?: boolean;
  metadata: { filename: string; ext: string; size: number };
}

export interface PodcastEpisode {
  id: string;
  libraryItemId: string;
  index: number | null;
  season: string | null;
  episode: string | null;
  episodeType: string | null;
  title: string;
  subtitle: string | null;
  description: string | null;
  pubDate: string | null;
  publishedAt: number | null;
  duration?: number;
  size?: number;
  audioFile?: AudioFile;
  audioTrack?: AudioTrack;
  chapters?: Chapter[];
}

export interface BookMedia {
  id: string;
  metadata: BookMetadata;
  coverPath: string | null;
  tags: string[];
  duration: number;
  numTracks?: number;
  numChapters?: number;
  numAudioFiles?: number;
  size?: number;
  chapters?: Chapter[];
  tracks?: AudioTrack[];
  audioFiles?: AudioFile[];
  ebookFile?: unknown;
  ebookFormat?: string | null;
}

export interface PodcastMedia {
  id: string;
  metadata: PodcastMetadata;
  coverPath: string | null;
  tags: string[];
  numEpisodes?: number;
  episodes?: PodcastEpisode[];
  autoDownloadEpisodes?: boolean;
}

export interface CollapsedSeries {
  id: string;
  name: string;
  numBooks: number;
  sequence?: string;
  libraryItemIds: string[];
}

export interface LibraryItem {
  id: string;
  libraryId: string;
  mediaType: MediaType;
  addedAt: number;
  updatedAt: number;
  isMissing: boolean;
  isInvalid: boolean;
  media: BookMedia | PodcastMedia;
  numFiles?: number;
  size?: number;
  collapsedSeries?: CollapsedSeries;
  userMediaProgress?: MediaProgress;
  recentEpisode?: PodcastEpisode;
  /** Present on items inside a series listing. */
  sequence?: string;
  progressLastUpdate?: number;
}

export interface MediaProgress {
  id: string;
  libraryItemId: string;
  episodeId: string | null;
  duration: number;
  progress: number;
  currentTime: number;
  isFinished: boolean;
  hideFromContinueListening: boolean;
  lastUpdate: number;
  startedAt: number;
  finishedAt: number | null;
}

export interface Bookmark {
  libraryItemId: string;
  time: number;
  title: string;
  createdAt: number;
}

export interface User {
  id: string;
  username: string;
  type: string;
  token?: string;
  accessToken?: string;
  refreshToken?: string | null;
  mediaProgress: MediaProgress[];
  bookmarks: Bookmark[];
  librariesAccessible: string[];
  permissions: Record<string, boolean>;
}

export interface Series {
  id: string;
  name: string;
  description: string | null;
  addedAt: number;
  books: LibraryItem[];
  totalDuration?: number;
}

export interface Author {
  id: string;
  name: string;
  description: string | null;
  imagePath: string | null;
  numBooks?: number;
  libraryItems?: LibraryItem[];
  series?: { id: string; name: string; items: LibraryItem[] }[];
}

export interface Collection {
  id: string;
  name: string;
  description: string | null;
  books: LibraryItem[];
  lastUpdate: number;
}

export interface Playlist {
  id: string;
  libraryId: string;
  userId: string;
  name: string;
  description: string | null;
  items: { libraryItemId: string; episodeId: string | null; libraryItem: LibraryItem; episode?: PodcastEpisode }[];
}

export type ShelfEntity = LibraryItem | Series | Author;

export interface Shelf {
  id: string;
  label: string;
  type: 'book' | 'podcast' | 'episode' | 'series' | 'authors';
  entities: ShelfEntity[];
}

export interface Paged<T> {
  results: T[];
  total: number;
  limit: number;
  page: number;
}

export interface PlaybackSession {
  id: string;
  libraryItemId: string;
  episodeId: string | null;
  mediaType: MediaType;
  displayTitle: string;
  displayAuthor: string;
  coverPath: string | null;
  duration: number;
  currentTime: number;
  chapters: Chapter[];
  audioTracks: AudioTrack[];
  libraryItem: LibraryItem;
}

export interface SearchResults {
  book?: { libraryItem: LibraryItem }[];
  podcast?: { libraryItem: LibraryItem }[];
  episodes?: { libraryItem: LibraryItem }[];
  series?: { series: Series; books: LibraryItem[] }[];
  authors?: Author[];
  narrators?: { name: string; numBooks: number }[];
  genres?: { name: string; numItems: number }[];
  tags?: { name: string; numItems: number }[];
}

export interface FilterData {
  authors: AuthorRef[];
  genres: string[];
  tags: string[];
  series: { id: string; name: string }[];
  narrators: string[];
  languages: string[];
  publishers: string[];
  bookCount?: number;
  authorCount?: number;
  seriesCount?: number;
  podcastCount?: number;
}

export interface ListeningSession {
  id: string;
  libraryItemId: string;
  episodeId: string | null;
  displayTitle: string;
  displayAuthor: string;
  timeListening: number;
  updatedAt: number;
  startedAt: number;
  mediaType: MediaType;
}

export interface ListeningStats {
  totalTime: number;
  today: number;
  days: Record<string, number>;
  dayOfWeek: Record<string, number>;
  items: Record<string, { id: string; timeListening: number; mediaMetadata: { title: string; authors?: AuthorRef[] } }>;
  recentSessions: ListeningSession[];
}

export function isBook(item: LibraryItem): item is LibraryItem & { media: BookMedia } {
  return item.mediaType === 'book';
}

export function isPodcast(item: LibraryItem): item is LibraryItem & { media: PodcastMedia } {
  return item.mediaType === 'podcast';
}

// --- library ---

/** The device a listening session was recorded on, as the client described itself. */
export interface SessionDevice {
  clientName?: string;
  clientVersion?: string;
  deviceName?: string;
  manufacturer?: string;
  model?: string;
  osName?: string;
  osVersion?: string;
  browserName?: string;
}

/** One entry of the listening history (`/api/me/listening-sessions`). */
export interface HistorySession extends ListeningSession {
  libraryId: string;
  mediaMetadata: { title?: string; authors?: AuthorRef[] } | null;
  coverPath: string | null;
  duration: number;
  /** Positions, in seconds, where listening started and where it stopped. */
  startTime: number;
  currentTime: number;
  deviceInfo: SessionDevice | null;
  mediaPlayer: string | null;
}

export interface SessionPage {
  total: number;
  numPages: number;
  page: number;
  itemsPerPage: number;
  sessions: HistorySession[];
}

export interface LibraryStats {
  totalItems: number;
  /** Book libraries only. */
  totalAuthors?: number;
  authorsWithCount?: { id: string; name: string; count: number }[];
  totalGenres: number;
  genresWithCount: { genre: string; count: number }[];
  /** Seconds. */
  totalDuration: number;
  /** Bytes. */
  totalSize: number;
  numAudioTracks: number;
  longestItems: { id: string; title: string; duration: number }[];
  largestItems: { id: string; title: string; size: number }[];
}

/** A year of the current user's listening (`/api/me/stats/year/:year`). Times are seconds. */
export interface YearStats {
  totalListeningSessions: number;
  totalListeningTime: number;
  totalBookListeningTime: number;
  totalPodcastListeningTime: number;
  topAuthors: { name: string; time: number }[] | null;
  topGenres: { genre: string; time: number }[] | null;
  mostListenedNarrator: { name: string; time: number } | null;
  /** `month` is 0-based. */
  mostListenedMonth: { month: number; time: number } | null;
  numBooksFinished: number;
  numBooksListened: number;
  longestAudiobookFinished: { id: string; title: string; duration: number; finishedAt: number } | null;
  /** Library item ids. */
  booksWithCovers: string[];
  finishedBooksWithCovers: string[];
}
