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

// --- podcasts ---

export interface LibraryFolder {
  id: string;
  fullPath: string;
  libraryId: string;
}

export type LibraryWithFolders = Library & { folders: LibraryFolder[] };

/** An episode as the server stores it, with what identifies it in the feed it came from. */
export type ServerEpisode = PodcastEpisode & {
  guid?: string | null;
  enclosure?: { url: string; type?: string | null; length?: string | null } | null;
  addedAt?: number;
};

/** A podcast's auto-download settings (on the item's media). */
export interface PodcastAutoDownload {
  autoDownloadEpisodes: boolean;
  /** Cron expression. */
  autoDownloadSchedule: string | null;
  /** 0 keeps every episode. */
  maxEpisodesToKeep: number;
  /** 0 downloads every new episode a check finds. */
  maxNewEpisodesToDownload: number;
  lastEpisodeCheck: number | null;
}

/** An iTunes search result, through the server (GET /api/search/podcast). */
export interface PodcastSearchResult {
  id: number;
  artistId: number | null;
  title: string;
  artistName: string;
  description: string;
  descriptionPlain: string;
  releaseDate: string;
  genres: string[];
  cover: string | null;
  trackCount: number;
  feedUrl: string | null;
  pageUrl: string;
  explicit: boolean;
}

export interface FeedMetadata {
  title: string | null;
  author: string | null;
  description: string | null;
  descriptionPlain: string | null;
  image: string | null;
  categories: string[];
  feedUrl: string;
  language: string | null;
  explicit: string | null;
  type: string | null;
  link: string | null;
}

/** An episode as the RSS feed lists it; this is also what the server takes to download one. */
export interface FeedEpisode {
  title: string;
  subtitle: string;
  description: string;
  descriptionPlain: string;
  pubDate: string;
  episodeType: string;
  season: string;
  episode: string;
  durationSeconds: number | null;
  publishedAt: number;
  enclosure: { url: string; type?: string; length?: string };
  guid: string;
  chapters?: unknown[];
}

export interface PodcastFeed {
  metadata: FeedMetadata;
  episodes: FeedEpisode[];
}

export interface NewPodcast {
  path: string;
  folderId: string;
  libraryId: string;
  media: {
    metadata: {
      title: string;
      author: string;
      description: string;
      releaseDate: string;
      genres: string[];
      feedUrl: string;
      imageUrl: string;
      itunesPageUrl: string;
      itunesId: string;
      itunesArtistId: string;
      language: string;
      explicit: boolean;
      type: string;
    };
    autoDownloadEpisodes: boolean;
  };
}

/** One episode in the server's download queue. */
export interface EpisodeDownload {
  id: string;
  episodeDisplayTitle: string | null;
  url: string;
  libraryItemId: string;
  libraryId: string | null;
  isFinished: boolean;
  failed: boolean;
  createdAt: number;
  finishedAt: number | null;
  podcastTitle: string | null;
  season: string | null;
  episode: string | null;
  publishedAt: number | null;
  guid: string | null;
}

/** An entry in a podcast library's "recent episodes", with its show attached. */
export type RecentEpisode = ServerEpisode & {
  podcast: PodcastMedia & { libraryItemId: string };
  libraryId: string;
};

// --- reader ---

/** Where the reader is in the item's ebook, kept on the same progress record as listening. */
export interface MediaProgress {
  /** An EPUB CFI, or a page number for PDFs (as the Audiobookshelf web reader stores it). */
  ebookLocation?: string | null;
  /** 0–1. */
  ebookProgress?: number | null;
}

export type EbookFormat = 'epub' | 'pdf' | 'mobi' | 'azw3' | 'cbz' | 'cbr' | (string & {});

export interface LibraryFile {
  ino: string;
  metadata: { filename: string; ext: string; path: string; relPath: string; size: number };
  fileType: string;
  /** For ebooks: false for the item's primary ebook, true for the other ones. */
  isSupplementary?: boolean | null;
  ebookFormat?: EbookFormat;
}

/** `media.ebookFile` on a book (expanded items; minified ones only carry `media.ebookFormat`). */
export interface EbookFile extends LibraryFile {
  ebookFormat: EbookFormat;
}

export interface LibraryItem {
  /** Every file in the item's folder (expanded items only). */
  libraryFiles?: LibraryFile[];
}
