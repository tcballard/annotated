const canUseMediaAsset = (media, actor, mimePrefix) => Boolean(
  media
  && String(media.mimeType || '').startsWith(mimePrefix)
  && actor?.id
  && media.ownerId === actor.id,
);

export const canUseAudioAsset = (media, actor) => canUseMediaAsset(media, actor, 'audio/');

export const canUseImageAsset = (media, actor) => canUseMediaAsset(media, actor, 'image/');
