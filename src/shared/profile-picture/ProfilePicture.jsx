// src/components/ProfilePicture/ProfilePicture.jsx

import { useRef } from 'react';
import '@shared/profile-picture/ProfilePicture.css';
import { compressImageToBase64 } from '@shared/media/ImageCompression.js';
import ResourceImage from '@shared/resource-image/ResourceImage.jsx';

/**
 * ProfilePicture component.
 * Shows the avatar; if `editable`, clicking opens the file picker.
 *
 * Props:
 *   src        – base64 string or null
 *   username   – player name (used for initials fallback)
 *   editable   – bool, shows upload affordance
 *   onUpload   – async (base64: string) => void
 *   size       – px number, default 80
 *   className  – extra CSS class
 */
export default function ProfilePicture({ src, username = '?', editable = false, onUpload, size = 80, className = '' }) {
    const inputRef = useRef(null);

    const initials = username
        .split(/\s+/)
        .slice(0, 2)
        .map(w => w[0]?.toUpperCase() ?? '')
        .join('');

    const handleFileChange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        // Profile pictures: 256 px max dimension, 30 KB target
        const b64 = await compressImageToBase64(file, 30, 256);
        onUpload?.(b64);
        e.target.value = '';
    };

    return (
        <div
            className={`pfp-wrap ${editable ? 'pfp-editable' : ''} ${className}`}
            style={{
                width: size,
                height: size,
                borderRadius: `var(--profile-avatar-radius, ${size * 0.12}px)`,
            }}
            onClick={() => editable && inputRef.current?.click()}
            title={editable ? 'Click to change picture' : username}
        >
            <ResourceImage
                value={src}
                alt={username}
                className="pfp-img"
                loading={editable || size >= 64 ? 'eager' : 'lazy'}
                fallback={(
                    <div className="pfp-initials" style={{ fontSize: size * 0.32 }}>
                        {initials || '?'}
                    </div>
                )}
            />

            {editable && (
                <div className="pfp-overlay">
                    <span className="pfp-upload-icon">⬆</span>
                </div>
            )}

            <input
                ref={inputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleFileChange}
            />
        </div>
    );
}
