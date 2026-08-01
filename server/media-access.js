export const canUseAudioAsset = (media, actor) => Boolean(
  media
  && String(media.mimeType || '').startsWith('audio/')
  && actor?.id
  && media.ownerId === actor.id,
);
