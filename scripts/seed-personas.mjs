// Seeds four demo personas — users, annotations, follows, responses, likes —
// so a fresh deployment reads like a place where people already live, not an
// empty room. Store-level (works against the file store locally and the
// PostgreSQL store on staging), idempotent, and guarded: it refuses to run
// when NODE_ENV=production unless ANNOTATED_SEED_PERSONAS=allow is set.
//
//   Locally:  npm run seed:personas
//   Staging:  ANNOTATED_STORAGE=postgres DATABASE_URL=… \
//             ANNOTATED_SEED_PERSONAS=allow npm run seed:personas
//
// Every excerpt below is verbatim from its source page, so the published
// #:~:text= deep links genuinely land on the quoted words.

import { randomUUID } from 'node:crypto';

// The guard must run before the store module loads — in production mode the
// store asserts its PostgreSQL configuration at import time.
if (process.env.NODE_ENV === 'production' && process.env.ANNOTATED_SEED_PERSONAS !== 'allow') {
  console.error('Refusing to seed personas in production. Set ANNOTATED_SEED_PERSONAS=allow to run intentionally.');
  process.exit(1);
}

const { closeStore, readStore, updateStore } = await import('../server/store.js');
const { validateAnnotation } = await import('../server/validation.js');

const hoursAgo = (hours) => new Date(Date.now() - hours * 3600 * 1000).toISOString();

const PERSONAS = [
  { key: 'mara', handle: 'mara.reads', displayName: 'Mara Ellison', bio: 'Margins first. Reader of old books and new essays.' },
  { key: 'priya', handle: 'dev.notes', displayName: 'Priya Sharma', bio: 'Engineer. I keep receipts.' },
  { key: 'sam', handle: 'thefootnote', displayName: 'Sam Okafor', bio: 'Historian by training, footnote by temperament.' },
  { key: 'jonas', handle: 'quietsignal', displayName: 'Jonas Weber', bio: 'Product, mostly. Opinions bounded like clips.' },
];

const ANNOTATIONS = [
  {
    key: 'mara-marginalia', topic: 'culture', author: 'mara', hours: 130, opens: 34, paragraph: 1,
    sourceUrl: 'https://en.wikipedia.org/wiki/Marginalia',
    sourceTitle: 'Marginalia - Wikipedia',
    excerpt: 'Marginalia (or apostils) are marks made in the margins of a book or other document.',
    note: 'We have been doing this for a thousand years — the margin is the oldest social network. The web just forgot to ship one.',
  },
  {
    key: 'mara-commonplace', topic: 'culture', author: 'mara', hours: 55, opens: 18, paragraph: 1,
    sourceUrl: 'https://en.wikipedia.org/wiki/Commonplace_book',
    sourceTitle: 'Commonplace book - Wikipedia',
    excerpt: 'Commonplace books (or commonplaces) are personal notebooks used to compile any information the owner finds interesting or useful.',
    note: 'A commonplace book with permalinks is roughly what I always wanted the internet to be.',
  },
  {
    key: 'priya-textfragments', topic: 'tech', author: 'priya', hours: 78, opens: 27, paragraph: 1,
    sourceUrl: 'https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment/Text_fragments',
    sourceTitle: 'Text fragments - URIs | MDN',
    excerpt: 'Text fragments link directly to specific text in a web page, without requiring the page author to add an ID.',
    note: 'The quiet superpower behind every “open original at the passage” link on this site — no cooperation needed from the source page. Click through and watch the browser highlight it.',
  },
  {
    key: 'sam-drolleries', topic: 'culture', author: 'sam', hours: 100, opens: 12, paragraph: 2,
    sourceUrl: 'https://en.wikipedia.org/wiki/Marginalia',
    sourceTitle: 'Marginalia - Wikipedia',
    excerpt: 'They may be scribbles, comments, glosses (annotations), critiques, doodles, drolleries, or illuminations.',
    note: 'Drolleries! Medieval readers doodled monsters in the margins of psalters. Annotation has never been a solemn practice.',
  },
  {
    key: 'jonas-unscalable', topic: 'startups', author: 'jonas', hours: 46, opens: 41, paragraph: 3,
    sourceUrl: 'https://paulgraham.com/ds.html',
    sourceTitle: 'Do Things that Don’t Scale',
    excerpt: 'The most common unscalable thing founders have to do at the start is to recruit users manually.',
    note: 'Every founder rereads this yearly and still under-does it. The manual era is the product era — you learn what to build by doing the job by hand.',
  },
  {
    key: 'jonas-makers', topic: 'startups', author: 'jonas', hours: 20, opens: 22, paragraph: 2,
    sourceUrl: 'https://paulgraham.com/makersschedule.html',
    sourceTitle: 'Maker’s Schedule, Manager’s Schedule',
    excerpt: 'There are two types of schedule, which I’ll call the manager’s schedule and the maker’s schedule.',
    note: 'Still the most cited essay in every engineering-planning argument I have ever been in, and still mostly unheeded.',
  },
  {
    key: 'priya-webannotation', topic: 'tech', author: 'priya', hours: 8, opens: 15, paragraph: 3,
    sourceUrl: 'https://en.wikipedia.org/wiki/Web_annotation',
    sourceTitle: 'Web annotation - Wikipedia',
    excerpt: 'With a web annotation system, a user can add, modify or remove information from a Web resource without modifying the resource itself.',
    note: 'The W3C wrote the spec years ago; the products kept dying anyway. The missing piece was never the standard — it was the feed.',
  },
  {
    key: 'sam-hypertext', topic: 'tech', author: 'sam', hours: 12, opens: 9, paragraph: 1,
    sourceUrl: 'https://en.wikipedia.org/wiki/Hypertext',
    sourceTitle: 'Hypertext - Wikipedia',
    excerpt: 'Hypertext is text displayed on a computer display or other electronic devices with references (hyperlinks) to other text that the reader can immediately access.',
    note: 'Bush sketched the Memex in 1945 with trails of association between documents. Links shipped; the trails — the annotations — mostly did not.',
  },
  {
    key: 'jonas-greatwork', topic: 'startups', author: 'jonas', hours: 30, opens: 33, paragraph: 4,
    sourceUrl: 'https://paulgraham.com/greatwork.html',
    sourceTitle: 'How to Do Great Work',
    excerpt: 'The work you choose needs to have three qualities: it has to be something you have a natural aptitude for, that you have a deep interest in, and that offers scope to do great work.',
    note: 'Aptitude, interest, scope. Most career agonising is people negotiating with the first two and pretending the third does not exist.',
  },
];

const FOLLOWS = [
  ['priya', 'mara'], ['sam', 'mara'], ['jonas', 'mara'],
  ['jonas', 'priya'], ['priya', 'jonas'],
  ['sam', 'priya'], ['sam', 'jonas'], ['mara', 'sam'],
];

const COMMENTS = [
  { key: 'persona-comment-1', annotation: 'mara-marginalia', author: 'priya', hours: 96, body: 'The margin as protocol, not product — that is the whole pitch.' },
  { key: 'persona-comment-2', annotation: 'jonas-unscalable', author: 'sam', hours: 30, body: 'Historians call this fieldwork. Founders keep rediscovering it under new names.' },
  { key: 'persona-comment-3', annotation: 'priya-textfragments', author: 'mara', hours: 50, body: 'Today I learned my highlights have a W3C spec.' },
  { key: 'persona-comment-4', annotation: 'priya-webannotation', author: 'jonas', hours: 5, body: 'Standards retain implementers. Feeds retain readers. Only one of those keeps a product alive.' },
  { key: 'persona-comment-5', annotation: 'sam-hypertext', author: 'mara', hours: 6, body: 'Bush imagined readers leaving trails for each other. We built the links and forgot the readers.' },
  { key: 'persona-comment-6', annotation: 'jonas-greatwork', author: 'sam', hours: 20, body: 'Aptitude, interest, scope — also a decent test for what deserves an annotation at all.' },
  { key: 'persona-comment-7', annotation: 'mara-commonplace', author: 'priya', hours: 40, body: 'Mine is a git repo with a NOTES.md that only ever grows.' },
];

const LIKES = [
  ['mara-marginalia', 'sam'], ['mara-marginalia', 'jonas'], ['mara-commonplace', 'priya'],
  ['priya-textfragments', 'mara'], ['priya-textfragments', 'jonas'],
  ['jonas-unscalable', 'priya'], ['jonas-unscalable', 'mara'], ['sam-drolleries', 'mara'],
  ['priya-webannotation', 'jonas'], ['priya-webannotation', 'sam'], ['priya-webannotation', 'mara'],
  ['sam-hypertext', 'mara'], ['jonas-greatwork', 'priya'], ['jonas-greatwork', 'mara'],
];

// With ANNOTATED_SEED_TARGET=<handle>, the personas turn their attention
// to a real account: they follow it, like its latest annotations, and
// leave responses — so that account's notifications screen (and bell
// badge) reads like a lived-in product instead of an empty room. This is
// what makes the demo recordable: the personas act on YOU.
const TARGET_HANDLE = (process.env.ANNOTATED_SEED_TARGET || '').replace(/^@/, '').trim() || null;

const TARGET_RESPONSES = [
  { author: 'mara', hoursAgo: 3, body: 'This is exactly what the margin was made for — the sourcing does the arguing.' },
  { author: 'jonas', hoursAgo: 1, body: 'Bounded and sourced. Following for more of these.' },
];

const summary = { users: 0, annotations: 0, follows: 0, comments: 0, likes: 0, targetFollows: 0, targetLikes: 0, targetResponses: 0 };
let targetFound = null;

await updateStore((store) => {
  const users = [...(store.users || [])];
  const annotations = [...(store.annotations || [])];
  const follows = [...(store.follows || [])];
  const comments = [...(store.comments || [])];
  const likes = [...(store.likes || [])];
  const userIds = {};

  for (const persona of PERSONAS) {
    const existing = users.find((user) => user.handle === persona.handle);
    if (existing) { existing.isDemo = true; userIds[persona.key] = existing.id; continue; }
    const user = {
      id: randomUUID(), provider: 'demo', providerId: `demo-${persona.handle}`,
      handle: persona.handle, displayName: persona.displayName, bio: persona.bio,
      email: null, avatarUrl: null, isDemo: true, createdAt: hoursAgo(24 * 14),
    };
    users.push(user);
    userIds[persona.key] = user.id;
    summary.users += 1;
  }

  const annotationIds = {};
  for (const seed of ANNOTATIONS) {
    const clientRequestId = `persona-${seed.key}`;
    const existing = annotations.find((item) => item.clientRequestId === clientRequestId);
    if (existing) { existing.isDemo = true; annotationIds[seed.key] = existing.id; continue; }
    const { errors, normalized } = validateAnnotation({
      sourceType: 'article', sourceUrl: seed.sourceUrl, canonicalUrl: seed.sourceUrl,
      sourceTitle: seed.sourceTitle, sourceHost: new URL(seed.sourceUrl).hostname.replace(/^www\./, ''),
      sourceExcerpt: seed.excerpt, anchorParagraph: seed.paragraph,
      commentary: seed.note, commentaryMode: 'text', visibility: 'public', topic: seed.topic || undefined, clientRequestId,
    });
    if (errors.length) throw new Error(`Persona seed ${seed.key} failed validation: ${errors.join('; ')}`);
    const id = randomUUID();
    const slugBase = seed.sourceTitle.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 48);
    annotations.push({
      id, slug: `${slugBase}-${id.slice(0, 6)}`, status: 'published',
      createdAt: hoursAgo(seed.hours), authorId: userIds[seed.author],
      mediaStatus: 'not-applicable', openCount: seed.opens, isDemo: true, ...normalized,
    });
    annotationIds[seed.key] = id;
    summary.annotations += 1;
  }

  for (const [follower, following] of FOLLOWS) {
    if (follows.some((edge) => edge.followerId === userIds[follower] && edge.followingId === userIds[following])) continue;
    follows.push({ followerId: userIds[follower], followingId: userIds[following], createdAt: hoursAgo(24 * 7) });
    summary.follows += 1;
  }

  for (const seed of COMMENTS) {
    const annotationId = annotationIds[seed.annotation];
    if (comments.some((comment) => comment.annotationId === annotationId && comment.authorId === userIds[seed.author] && comment.body === seed.body)) continue;
    comments.push({ id: randomUUID(), annotationId, authorId: userIds[seed.author], body: seed.body, createdAt: hoursAgo(seed.hours) });
    summary.comments += 1;
  }

  for (const [annotation, user] of LIKES) {
    if (likes.some((like) => like.annotationId === annotationIds[annotation] && like.userId === userIds[user])) continue;
    likes.push({ annotationId: annotationIds[annotation], userId: userIds[user], createdAt: hoursAgo(24) });
    summary.likes += 1;
  }

  if (TARGET_HANDLE) {
    const target = users.find((user) => user.handle === TARGET_HANDLE);
    if (target) {
      targetFound = target;
      // Everyone follows the target, at staggered recent times so the
      // notifications read as a stream, not a batch.
      PERSONAS.forEach((persona, index) => {
        if (follows.some((edge) => edge.followerId === userIds[persona.key] && edge.followingId === target.id)) return;
        follows.push({ followerId: userIds[persona.key], followingId: target.id, createdAt: hoursAgo(2 + index * 5) });
        summary.targetFollows += 1;
      });
      const targetAnnotations = annotations
        .filter((item) => item.authorId === target.id && item.status === 'published')
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, 3);
      // Likes land on the latest few from different personas; responses on
      // the newest one. Both only exist if the target has published.
      targetAnnotations.forEach((annotation, index) => {
        for (const persona of ['mara', 'sam', 'priya'].slice(0, 3 - index)) {
          if (likes.some((like) => like.annotationId === annotation.id && like.userId === userIds[persona])) continue;
          likes.push({ annotationId: annotation.id, userId: userIds[persona], createdAt: hoursAgo(1 + index * 4) });
          summary.targetLikes += 1;
        }
      });
      if (targetAnnotations[0]) {
        for (const seed of TARGET_RESPONSES) {
          if (comments.some((comment) => comment.annotationId === targetAnnotations[0].id && comment.authorId === userIds[seed.author] && comment.body === seed.body)) continue;
          comments.push({ id: randomUUID(), annotationId: targetAnnotations[0].id, authorId: userIds[seed.author], body: seed.body, createdAt: hoursAgo(seed.hoursAgo) });
          summary.targetResponses += 1;
        }
      }
    }
  }

  return { ...store, users, annotations, follows, comments, likes };
});

const store = await readStore();
console.log(`Personas seeded: +${summary.users} users, +${summary.annotations} annotations, +${summary.follows} follows, +${summary.comments} responses, +${summary.likes} likes.`);
if (TARGET_HANDLE && !targetFound) {
  console.warn(`Target @${TARGET_HANDLE} not found — sign in once so the account exists, then re-run.`);
} else if (targetFound) {
  console.log(`Personas turned toward @${TARGET_HANDLE}: +${summary.targetFollows} follows, +${summary.targetLikes} likes, +${summary.targetResponses} responses.`);
  if (!summary.targetLikes && !summary.targetResponses) {
    const hasAnnotations = (store.annotations || []).some((item) => item.authorId === targetFound.id && item.status === 'published');
    if (!hasAnnotations) console.log(`@${TARGET_HANDLE} has no published annotations yet — publish one and re-run for likes and responses.`);
  }
}
console.log(`Store now holds ${store.users.length} users and ${store.annotations.length} annotations. Re-running changes nothing.`);
await closeStore();
