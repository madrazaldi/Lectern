<script lang="ts">
  import { History } from '@lucide/svelte';
  import * as abs from '$lib/api/abs';
  import Cover from '$lib/components/Cover.svelte';
  import ErrorState from '$lib/components/ErrorState.svelte';
  import Loading from '$lib/components/Loading.svelte';
  import { session } from '$lib/stores/session.svelte';
  import { bytes, duration, plural, relative } from '$lib/util/format';
  import { resource } from '$lib/util/resource.svelte';
  import { pageTitle } from '$lib/util/title';

  // Per user: the cache outlives a sign-out and back in as someone else.
  const res = resource(() => session.user?.id ?? null, {
    id: (k) => `stats:${k}`,
    load: () => abs.getListeningStats()
  });
  const stats = $derived(res.data ?? null);
  let hover = $state<{ x: number; y: number; label: string; value: string } | null>(null);

  const DAY = 86_400_000;
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // 53 weeks ending this week, Sunday-first columns.
  const weeks = $derived.by(() => {
    if (!stats) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today.valueOf() - (52 * 7 + today.getDay()) * DAY);
    const cols: { date: Date; secs: number; future: boolean }[][] = [];
    for (let w = 0; w < 53; w++) {
      const col = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(start.valueOf() + (w * 7 + d) * DAY);
        col.push({ date, secs: stats.days[key(date)] ?? 0, future: date > today });
      }
      cols.push(col);
    }
    return cols;
  });

  const maxDay = $derived(Math.max(1, ...weeks.flat().map((c) => c.secs)));
  // Four sequential steps of the accent, from faint to full.
  function level(secs: number) {
    if (secs <= 0) return 0;
    const r = secs / maxDay;
    return r > 0.66 ? 4 : r > 0.33 ? 3 : r > 0.1 ? 2 : 1;
  }

  // Label the first week of each month; drop a leading partial month that would collide with the next label.
  const monthLabels = $derived(
    weeks
      .map((col, i) => ({ i, d: col[0].date }))
      .filter(({ d, i }) => i === 0 || d.getDate() <= 7)
      .filter((m, idx, all) => !(idx === 0 && all[1] && all[1].i - m.i < 3))
      .map(({ i, d }) => ({ i, label: d.toLocaleDateString(undefined, { month: 'short' }) }))
  );

  const last7 = $derived.by(() => {
    if (!stats) return 0;
    let sum = 0;
    for (let i = 0; i < 7; i++) sum += stats.days[key(new Date(Date.now() - i * DAY))] ?? 0;
    return sum;
  });

  const streak = $derived.by(() => {
    if (!stats) return 0;
    let n = 0;
    let d = new Date();
    if (!stats.days[key(d)]) d = new Date(d.valueOf() - DAY);
    while (stats.days[key(d)]) {
      n++;
      d = new Date(d.valueOf() - DAY);
    }
    return n;
  });

  const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const weekdayMax = $derived(Math.max(1, ...weekdays.map((d) => stats?.dayOfWeek[d] ?? 0)));

  const topItems = $derived(
    Object.values(stats?.items ?? {})
      .toSorted((a, b) => b.timeListening - a.timeListening)
      .slice(0, 8)
  );
  const topMax = $derived(Math.max(1, topItems[0]?.timeListening ?? 1));

  // The year in review: the server's summary for the chosen year, with months filled in from the daily totals.
  const thisYear = new Date().getFullYear();
  let year = $state(thisYear);
  const years = $derived.by(() => {
    const first = Math.min(thisYear, ...Object.keys(stats?.days ?? {}).map((d) => Number(d.slice(0, 4)) || thisYear));
    return Array.from({ length: thisYear - first + 1 }, (_, i) => thisYear - i);
  });
  const yearRes = resource(() => (session.user ? { user: session.user.id, year } : null), {
    id: (k) => `stats:year:${k.user}:${k.year}`,
    load: (k, signal) => abs.getYearStats(k.year, signal)
  });
  const review = $derived(yearRes.data ?? null);
  const months = $derived.by(() => {
    const sums = Array<number>(12).fill(0);
    for (const [day, secs] of Object.entries(stats?.days ?? {})) if (day.startsWith(`${year}-`)) sums[Number(day.slice(5, 7)) - 1] += secs;
    return sums.map((secs, m) => ({ secs, name: new Date(year, m, 1).toLocaleDateString(undefined, { month: 'long' }) }));
  });
  const monthMax = $derived(Math.max(1, ...months.map((m) => m.secs)));
  const monthName = (m: number) => new Date(year, m, 1).toLocaleDateString(undefined, { month: 'long' });

  // The current library at a glance.
  const libRes = resource(() => session.library?.id ?? null, {
    id: (k) => `stats:library:${k}`,
    load: (k, signal) => abs.getLibraryStats(k, signal)
  });
  const lib = $derived(libRes.data ?? null);

  interface Rank {
    key: string;
    label: string;
    href?: string;
    value: number;
    text: string;
  }
  const rankAuthors = $derived<Rank[]>(
    (lib?.authorsWithCount ?? [])
      .slice(0, 8)
      .map((a) => ({ key: a.id, label: a.name, href: `/authors/${a.id}`, value: a.count, text: plural(a.count, 'title') }))
  );
  const rankGenres = $derived<Rank[]>(
    (lib?.genresWithCount ?? []).slice(0, 8).map((g) => ({
      key: g.genre,
      label: g.genre,
      href: `/library?filter=${encodeURIComponent(abs.encodeFilter('genres', g.genre))}&label=${encodeURIComponent(g.genre)}`,
      value: g.count,
      text: plural(g.count, 'title')
    }))
  );
  const rankLongest = $derived<Rank[]>(
    (lib?.longestItems ?? [])
      .slice(0, 8)
      .map((i) => ({ key: i.id, label: i.title, href: `/item/${i.id}`, value: i.duration, text: duration(i.duration, { short: true }) }))
  );
  const rankLargest = $derived<Rank[]>(
    (lib?.largestItems ?? []).slice(0, 8).map((i) => ({ key: i.id, label: i.title, href: `/item/${i.id}`, value: i.size, text: bytes(i.size) }))
  );

  function showTip(e: MouseEvent, label: string, value: string) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    hover = { x: r.left + r.width / 2, y: r.top, label, value };
  }
</script>

<svelte:head><title>{pageTitle('Listening')}</title></svelte:head>

{#snippet ranks(rows: Rank[], empty: string)}
  {@const max = Math.max(1, ...rows.map((r) => r.value))}
  <ol class="top">
    {#each rows as r (r.key)}
      <li>
        <svelte:element this={r.href ? 'a' : 'div'} href={r.href} class="rank-row">
          <span class="top-main">
            <span class="top-t">{r.label}</span>
            <span class="bar-track"><span class="bar" style:width="{(r.value / max) * 100}%"></span></span>
          </span>
          <span class="num faint">{r.text}</span>
        </svelte:element>
      </li>
    {:else}
      <li class="faint">{empty}</li>
    {/each}
  </ol>
{/snippet}

<div class="page">
  <header class="head">
    <h1 class="page-title">Listening</h1>
    <a class="btn btn-quiet" href="/history"><History size={16} /> Full history</a>
  </header>

  {#if res.error}
    <ErrorState title="Couldn't load your listening history" message={res.error} cause={res.cause} onretry={() => res.refresh()} />
  {:else if !stats}
    <Loading label="Loading your listening history" />
  {:else}
    <section class="totals" aria-label="Totals">
      <div><span class="v num">{duration(stats.totalTime, { short: true })}</span><span class="l">listened in all</span></div>
      <div><span class="v num">{duration(last7, { short: true })}</span><span class="l">in the last 7 days</span></div>
      <div><span class="v num">{duration(stats.today, { short: true })}</span><span class="l">today</span></div>
      <div><span class="v num">{streak}</span><span class="l">{streak === 1 ? 'day' : 'days'} in a row</span></div>
    </section>

    <section class="block">
      <h2 class="serif">The past year</h2>
      <div class="cal-wrap">
        <div class="months" style:grid-template-columns="repeat(53, 1fr)">
          {#each monthLabels as m (m.i)}<span style:grid-column={m.i + 1} style:grid-row="1">{m.label}</span>{/each}
        </div>
        <div class="cal" role="img" aria-label="Daily listening over the past year">
          {#each weeks as col, w (w)}
            <div class="wk">
              {#each col as c (c.date.valueOf())}
                <span
                  class="cell l{level(c.secs)}"
                  class:future={c.future}
                  role="presentation"
                  onmouseenter={(e) =>
                    showTip(
                      e,
                      c.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
                      c.secs ? duration(c.secs) : 'No listening'
                    )}
                  onmouseleave={() => (hover = null)}
                ></span>
              {/each}
            </div>
          {/each}
        </div>
        <div class="legend faint">
          Less
          {#each [0, 1, 2, 3, 4] as l (l)}<span class="cell l{l}"></span>{/each}
          More
        </div>
      </div>
    </section>

    <div class="two">
      <section class="block">
        <h2 class="serif">By day of the week</h2>
        <div class="bars" role="list">
          {#each weekdays as d (d)}
            {@const v = stats.dayOfWeek[d] ?? 0}
            <div class="bar-row" role="listitem" onmouseenter={(e) => showTip(e, d, duration(v))} onmouseleave={() => (hover = null)}>
              <span class="bar-l">{d.slice(0, 3)}</span>
              <span class="bar-track"><span class="bar" style:width="{(v / weekdayMax) * 100}%"></span></span>
              <span class="bar-v num faint">{duration(v, { short: true })}</span>
            </div>
          {/each}
        </div>
      </section>

      <section class="block">
        <h2 class="serif">Most listened</h2>
        <ol class="top">
          {#each topItems as it (it.id)}
            <li>
              <a href="/item/{it.id}" class="top-row">
                <span class="thumb"><Cover itemId={it.id} title={it.mediaMetadata.title} width={80} aspect={1} /></span>
                <span class="top-main">
                  <span class="top-t">{it.mediaMetadata.title}</span>
                  <span class="bar-track"><span class="bar" style:width="{(it.timeListening / topMax) * 100}%"></span></span>
                </span>
                <span class="num faint">{duration(it.timeListening, { short: true })}</span>
              </a>
            </li>
          {:else}
            <li class="faint">Nothing yet.</li>
          {/each}
        </ol>
      </section>
    </div>

    {#if stats.recentSessions.length}
      <section class="block">
        <div class="block-head">
          <h2 class="serif">Recent sessions</h2>
          <a class="link" href="/history">See all your history</a>
        </div>
        <table>
          <thead><tr><th>Title</th><th>Author</th><th class="r">Listened</th><th class="r">When</th></tr></thead>
          <tbody>
            {#each stats.recentSessions.slice(0, 12) as s (s.id)}
              <tr>
                <td><a href="/item/{s.libraryItemId}">{s.displayTitle}</a></td>
                <td class="faint">{s.displayAuthor}</td>
                <td class="r num">{duration(s.timeListening, { short: true })}</td>
                <td class="r faint">{relative(s.updatedAt)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </section>
    {/if}

    <section class="block" aria-labelledby="year-h">
      <div class="block-head">
        <h2 class="serif" id="year-h">Your year in listening</h2>
        <select class="select" bind:value={year} aria-label="Year">
          {#each years as y (y)}<option value={y}>{y}</option>{/each}
        </select>
      </div>
      {#if yearRes.error}
        <p class="faint">Couldn't load {year}. <button class="link" onclick={() => yearRes.refresh()}>Try again</button></p>
      {:else if !review}
        <Loading inline label="Loading {year}" />
      {:else if !review.totalListeningSessions}
        <p class="faint">No listening recorded in {year}.</p>
      {:else}
        <div class="totals small">
          <div><span class="v num">{duration(review.totalListeningTime, { short: true })}</span><span class="l">listened</span></div>
          <div>
            <span class="v num">{review.totalListeningSessions.toLocaleString()}</span><span class="l"
              >{review.totalListeningSessions === 1 ? 'session' : 'sessions'}</span
            >
          </div>
          <div>
            <span class="v num">{review.numBooksListened.toLocaleString()}</span><span class="l"
              >{review.numBooksListened === 1 ? 'book' : 'books'} listened to</span
            >
          </div>
          <div>
            <span class="v num">{review.numBooksFinished.toLocaleString()}</span><span class="l"
              >{review.numBooksFinished === 1 ? 'book' : 'books'} finished</span
            >
          </div>
        </div>
        <div class="two">
          <div>
            <h3>Month by month</h3>
            <div class="months-chart" role="list" aria-label="Listening per month in {year}">
              {#each months as m, i (i)}
                <div
                  class="col"
                  role="listitem"
                  aria-label="{m.name}: {m.secs ? duration(m.secs) : 'no listening'}"
                  onmouseenter={(e) => showTip(e, `${m.name} ${year}`, m.secs ? duration(m.secs) : 'No listening')}
                  onmouseleave={() => (hover = null)}
                >
                  <span class="col-track"
                    ><span class="col-bar" class:peak={m.secs === monthMax && m.secs > 0} style:height="{(m.secs / monthMax) * 100}%"></span></span
                  >
                  <span class="col-l" aria-hidden="true">{m.name.slice(0, 1)}</span>
                </div>
              {/each}
            </div>
          </div>
          <dl class="facts">
            {#if review.mostListenedMonth}
              <div>
                <dt>Busiest month</dt>
                <dd>{monthName(review.mostListenedMonth.month)} <span class="faint num">{duration(review.mostListenedMonth.time, { short: true })}</span></dd>
              </div>
            {/if}
            {#if review.topAuthors?.length}
              <div>
                <dt>Top {review.topAuthors.length === 1 ? 'author' : 'authors'}</dt>
                <dd>
                  {#each review.topAuthors as a, i (a.name)}{i ? ', ' : ''}{a.name}{/each}
                </dd>
              </div>
            {/if}
            {#if review.topGenres?.length}
              <div>
                <dt>Top {review.topGenres.length === 1 ? 'genre' : 'genres'}</dt>
                <dd>{review.topGenres.map((g) => g.genre).join(', ')}</dd>
              </div>
            {/if}
            {#if review.mostListenedNarrator}
              <div>
                <dt>Most heard narrator</dt>
                <dd>{review.mostListenedNarrator.name}</dd>
              </div>
            {/if}
            {#if review.longestAudiobookFinished}
              <div>
                <dt>Longest book finished</dt>
                <dd>
                  {review.longestAudiobookFinished.title} <span class="faint num">{duration(review.longestAudiobookFinished.duration, { short: true })}</span>
                </dd>
              </div>
            {/if}
            {#if review.totalPodcastListeningTime > 0}
              <div>
                <dt>Books and podcasts</dt>
                <dd class="num">
                  {duration(review.totalBookListeningTime, { short: true })} and {duration(review.totalPodcastListeningTime, { short: true })}
                </dd>
              </div>
            {/if}
          </dl>
        </div>
        {#if review.finishedBooksWithCovers.length || review.booksWithCovers.length}
          <ul class="covers" aria-label="Titles you listened to in {year}">
            {#each [...review.finishedBooksWithCovers, ...review.booksWithCovers] as id (id)}
              <li>
                <a href="/item/{id}"><Cover itemId={id} width={160} aspect={1} /></a>
                {#if review.finishedBooksWithCovers.includes(id)}<span class="done-tag">Finished</span>{/if}
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </section>
  {/if}

  {#if session.library}
    <section class="block" aria-labelledby="lib-h">
      <h2 class="serif" id="lib-h">{session.library.name} at a glance</h2>
      {#if libRes.error}
        <p class="faint">Couldn't load the library's numbers. <button class="link" onclick={() => libRes.refresh()}>Try again</button></p>
      {:else if !lib}
        <Loading inline label="Loading library numbers" />
      {:else}
        <div class="totals small">
          <div>
            <span class="v num">{lib.totalItems.toLocaleString()}</span><span class="l">{session.library.mediaType === 'podcast' ? 'podcasts' : 'titles'}</span>
          </div>
          {#if lib.totalAuthors !== undefined}
            <div><span class="v num">{lib.totalAuthors.toLocaleString()}</span><span class="l">{lib.totalAuthors === 1 ? 'author' : 'authors'}</span></div>
          {/if}
          <div><span class="v num">{duration(lib.totalDuration, { short: true })}</span><span class="l">to listen to</span></div>
          <div><span class="v num">{bytes(lib.totalSize)}</span><span class="l">in {plural(lib.numAudioTracks, 'audio file')}</span></div>
        </div>
        <div class="two ranks">
          {#if lib.authorsWithCount}
            <div>
              <h3>Most titles by</h3>
              {@render ranks(rankAuthors, 'No authors yet.')}
            </div>
          {/if}
          <div>
            <h3>Genres</h3>
            {@render ranks(rankGenres, 'No genres recorded.')}
          </div>
          <div>
            <h3>Longest</h3>
            {@render ranks(rankLongest, 'Nothing yet.')}
          </div>
          <div>
            <h3>Largest</h3>
            {@render ranks(rankLargest, 'Nothing yet.')}
          </div>
        </div>
      {/if}
    </section>
  {/if}
</div>

{#if hover}
  <div class="tip" style:left="{hover.x}px" style:top="{hover.y}px">
    <span class="faint">{hover.label}</span>
    <strong class="num">{hover.value}</strong>
  </div>
{/if}

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .block-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    max-width: 980px;
  }
  .block-head h2 {
    margin-bottom: 16px;
  }
  .block-head .link {
    font-size: var(--t-sm);
  }
  h3 {
    font-size: var(--t-sm);
    font-weight: 650;
    color: var(--text-2);
    margin: 28px 0 12px;
  }
  /* The headings' own top margin separates the rows. */
  .two.ranks {
    row-gap: 8px;
  }
  .totals.small {
    margin-top: 0;
  }
  .totals.small .v {
    font-size: var(--t-xl);
  }
  .months-chart {
    display: grid;
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: 6px;
    height: 150px;
  }
  .col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .col-track {
    position: relative;
    flex: 1;
    width: 100%;
    max-width: 28px;
  }
  .col-bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    min-height: 2px;
    border-radius: 4px 4px 0 0;
    background: color-mix(in srgb, var(--accent) 62%, var(--raised-2));
  }
  .col-bar.peak {
    background: var(--accent);
  }
  .col:hover .col-bar {
    outline: 2px solid var(--text);
    outline-offset: 1px;
  }
  .col-l {
    font-size: var(--t-xs);
    color: var(--text-3);
  }
  .facts {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin: 28px 0 0;
  }
  .facts dt {
    font-size: var(--t-xs);
    color: var(--text-3);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 650;
  }
  .facts dd {
    margin: 2px 0 0;
    font-family: var(--font-serif);
    font-size: var(--t-md);
    font-weight: 560;
  }
  .facts dd .faint {
    font-family: var(--font-sans);
    font-size: var(--t-sm);
    font-weight: 400;
    margin-left: 6px;
  }
  .covers {
    list-style: none;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
    gap: 14px;
    max-width: 980px;
    margin: 28px 0 0;
    padding: 0;
  }
  .covers li {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .done-tag {
    font-size: var(--t-xs);
    color: var(--accent);
    font-weight: 600;
  }
  .rank-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 12px;
    align-items: center;
    font-size: var(--t-sm);
  }
  a.rank-row:hover .top-t {
    color: var(--accent);
  }
  .totals {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    margin-top: 28px;
    border-top: 1px solid var(--rule-soft);
    border-bottom: 1px solid var(--rule-soft);
  }
  .totals > div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 20px 24px 20px 0;
  }
  .totals > div + div {
    padding-left: 24px;
    border-left: 1px solid var(--rule-soft);
  }
  .v {
    font-family: var(--font-serif);
    font-size: var(--t-2xl);
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  .l {
    color: var(--text-2);
    font-size: var(--t-sm);
  }
  .block {
    margin-top: 44px;
  }
  h2 {
    font-size: var(--t-lg);
    font-weight: 620;
    margin-bottom: 16px;
  }
  .cal-wrap {
    max-width: 980px;
  }
  .months span {
    white-space: nowrap;
    overflow: visible;
  }
  .months {
    display: grid;
    gap: 3px;
    font-size: var(--t-xs);
    color: var(--text-3);
    margin-bottom: 6px;
  }
  .cal {
    display: grid;
    grid-template-columns: repeat(53, 1fr);
    gap: 3px;
  }
  .wk {
    display: grid;
    grid-template-rows: repeat(7, 1fr);
    gap: 3px;
  }
  .cell {
    display: block;
    aspect-ratio: 1;
    border-radius: 3px;
    background: var(--raised-2);
  }
  .cal .cell:hover {
    outline: 2px solid var(--text);
    outline-offset: 1px;
  }
  .cell.future {
    visibility: hidden;
  }
  .l1 {
    background: color-mix(in srgb, var(--accent) 28%, var(--raised-2));
  }
  .l2 {
    background: color-mix(in srgb, var(--accent) 52%, var(--raised-2));
  }
  .l3 {
    background: color-mix(in srgb, var(--accent) 76%, var(--raised-2));
  }
  .l4 {
    background: var(--accent);
  }
  .legend {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    margin-top: 10px;
    font-size: var(--t-xs);
  }
  .legend .cell {
    width: 12px;
  }
  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 56px;
  }
  .bars {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .bar-row {
    display: grid;
    grid-template-columns: 40px 1fr 64px;
    align-items: center;
    gap: 12px;
    font-size: var(--t-sm);
  }
  .bar-track {
    display: block;
    height: 8px;
    border-radius: 4px;
    background: var(--raised-2);
    overflow: hidden;
  }
  .bar {
    display: block;
    height: 100%;
    border-radius: 4px;
    background: var(--accent);
  }
  .bar-v {
    text-align: right;
    font-size: var(--t-xs);
  }
  .top {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .top-row {
    display: grid;
    grid-template-columns: 36px 1fr auto;
    gap: 12px;
    align-items: center;
    font-size: var(--t-sm);
  }
  .top-row:hover .top-t {
    color: var(--accent);
  }
  .top-main {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .top-t {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .top .bar-track {
    height: 4px;
  }
  table {
    width: 100%;
    max-width: 980px;
    border-collapse: collapse;
    font-size: var(--t-sm);
  }
  th {
    text-align: left;
    font-weight: 600;
    color: var(--text-3);
    font-size: var(--t-xs);
    padding: 0 12px 8px 0;
    border-bottom: 1px solid var(--rule);
  }
  td {
    padding: 10px 12px 10px 0;
    border-bottom: 1px solid var(--rule-soft);
  }
  td a:hover {
    color: var(--accent);
  }
  .r {
    text-align: right;
  }
  .tip {
    position: fixed;
    z-index: 60;
    transform: translate(-50%, calc(-100% - 10px));
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 6px 10px;
    border-radius: var(--r-sm);
    background: var(--raised-2);
    border: 1px solid var(--rule);
    box-shadow: 0 10px 24px -8px rgb(0 0 0 / 0.5);
    font-size: var(--t-xs);
    pointer-events: none;
    white-space: nowrap;
  }
  @media (max-width: 1180px) {
    .two {
      grid-template-columns: 1fr;
    }
  }
</style>
