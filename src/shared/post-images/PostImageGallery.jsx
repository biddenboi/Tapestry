import { useEffect, useState } from 'react';
import { getPostImageKey, normalizePostImages } from '@domain/feed/PostImages.js';
import ResourceImage from '@shared/resource-image/ResourceImage.jsx';
import '@shared/post-images/PostImages.css';

export default function PostImageGallery({
  images,
  title = 'Post image',
  variant = 'feed',
  onOpen,
}) {
  const normalized = normalizePostImages(images);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, normalized.length - 1)));
  }, [normalized.length]);

  if (normalized.length === 0) return null;

  if (variant === 'feed') {
    return (
      <div
        className={`post-image-gallery post-image-gallery--feed post-image-gallery--count-${normalized.length}`}
        style={{ '--post-image-columns': Math.min(normalized.length, 4) }}
      >
        {normalized.map((image, index) => (
          <button
            key={getPostImageKey(image, index)}
            type="button"
            className="post-image-thumb"
            onClick={onOpen}
            disabled={!onOpen}
            aria-label={onOpen ? `Open ${title || 'post image'} ${index + 1}` : undefined}
          >
            <ResourceImage
              value={image}
              alt={`${title || 'Post image'}${normalized.length > 1 ? ` ${index + 1}` : ''}`}
              loading="lazy"
            />
          </button>
        ))}
      </div>
    );
  }

  const move = (direction) => {
    setActiveIndex((index) => (
      (index + direction + normalized.length) % normalized.length
    ));
  };
  const activeImage = normalized[activeIndex];

  return (
    <div className={`post-image-gallery post-image-gallery--${variant}`}>
      <button
        type="button"
        className="post-image-stage"
        onClick={onOpen}
        disabled={!onOpen}
        aria-label={onOpen ? `Open ${title || 'post image'}` : undefined}
      >
        <ResourceImage
          key={getPostImageKey(activeImage, activeIndex)}
          value={activeImage}
          alt={`${title || 'Post image'}${normalized.length > 1 ? ` ${activeIndex + 1}` : ''}`}
          loading="lazy"
        />
      </button>
      {normalized.length > 1 && (
        <>
          <button
            type="button"
            className="post-image-nav post-image-nav--prev"
            onClick={(event) => { event.stopPropagation(); move(-1); }}
            aria-label="Previous image"
          >
            {'<'}
          </button>
          <button
            type="button"
            className="post-image-nav post-image-nav--next"
            onClick={(event) => { event.stopPropagation(); move(1); }}
            aria-label="Next image"
          >
            {'>'}
          </button>
          <span className="post-image-count">{activeIndex + 1} / {normalized.length}</span>
        </>
      )}
    </div>
  );
}
