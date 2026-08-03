import { useRef, useState } from 'react';
import {
  compressPostImageFiles,
  getPostImageKey,
  MAX_POST_IMAGES,
  normalizePostImages,
} from '@domain/feed/PostImages.js';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { STORES } from '@domain/constants.js';
import { findOrCreateResource } from '@shared/resources/Resources.js';
import ResourceImage from '@shared/resource-image/ResourceImage.jsx';
import '@shared/post-images/PostImages.css';

export default function PostImagePicker({
  images,
  onChange,
  disabled = false,
  onProcessingChange,
}) {
  const { databaseConnection, currentPlayer } = useAppContext();
  const inputRef = useRef(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const normalized = normalizePostImages(images);
  const remaining = MAX_POST_IMAGES - normalized.length;

  const handleFiles = async (event) => {
    // FileList is live: clearing the input before copying it empties the
    // selection and makes the upload silently do nothing.
    const files = Array.from(event.target.files || []);
    if (!files.length || remaining <= 0) return;

    setProcessing(true);
    onProcessingChange?.(true);
    setError('');
    try {
      const next = await compressPostImageFiles(files, remaining);
      if (next.length === 0) {
        setError('Choose a supported image file.');
        return;
      }
      const resources = [];
      for (const dataUrl of next) {
        resources.push(await findOrCreateResource(databaseConnection, dataUrl, {
          parent: currentPlayer?.UUID || null,
          kind: 'journalImage',
          usedBy: [{ store: STORES.journal, UUID: null, field: 'images' }],
        }));
      }
      onChange([...normalized, ...resources]);
    } catch (uploadError) {
      console.warn('[PostImagePicker] image processing failed:', uploadError);
      setError('One of the selected images could not be processed.');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
      setProcessing(false);
      onProcessingChange?.(false);
    }
  };

  const removeImage = (index) => {
    onChange(normalized.filter((_, imageIndex) => imageIndex !== index));
  };

  return (
    <div className="post-image-picker">
      <div className="post-image-picker-head">
        <div>
          <span className="post-image-picker-title">IMAGES</span>
          <span className="post-image-picker-meta">{normalized.length} / {MAX_POST_IMAGES}</span>
        </div>
        <button
          type="button"
          className="post-image-add"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || processing || remaining <= 0}
        >
          {processing ? 'PROCESSING...' : '+ ADD IMAGES'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFiles}
          disabled={disabled || processing || remaining <= 0}
        />
      </div>

      {normalized.length > 0 && (
        <div className="post-image-picker-grid">
          {normalized.map((src, index) => (
            <div className="post-image-picker-item" key={getPostImageKey(src, index)}>
              <ResourceImage value={src} alt={`Selected upload ${index + 1}`} />
              <button
                type="button"
                onClick={() => removeImage(index)}
                disabled={disabled || processing}
                aria-label={`Remove image ${index + 1}`}
              >
                X
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <div className="post-image-picker-error">{error}</div>}
    </div>
  );
}
