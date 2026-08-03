import { compressImageToBase64 } from '@shared/media/ImageCompression.js';
import { isResourceRef } from '@shared/resources/Resources.js';

export const MAX_POST_IMAGES = 4;
export const POST_IMAGE_TARGET_KB = 240;
export const POST_IMAGE_MAX_DIM = 1600;

export function normalizePostImages(images) {
  const values = Array.isArray(images) ? images : images ? [images] : [];
  return values
    .filter((image) => (
      isResourceRef(image)
      || typeof image === 'string' && (
        image.startsWith('data:image/')
        || image.startsWith('blob:')
        || image.startsWith('http://')
        || image.startsWith('https://')
      )
    ))
    .slice(0, MAX_POST_IMAGES);
}

export function getPostImageKey(image, index = 0) {
  if (isResourceRef(image)) return `${index}-${image.resourceUUID}`;
  return `${index}-${String(image || '').slice(-24)}`;
}

export async function compressPostImageFiles(files, availableSlots = MAX_POST_IMAGES) {
  const imageFiles = Array.from(files || [])
    .filter((file) => file?.type?.startsWith('image/'))
    .slice(0, Math.max(0, availableSlots));

  const compressed = [];
  for (const file of imageFiles) {
    compressed.push(await compressImageToBase64(file, POST_IMAGE_TARGET_KB, POST_IMAGE_MAX_DIM));
  }
  return compressed;
}
