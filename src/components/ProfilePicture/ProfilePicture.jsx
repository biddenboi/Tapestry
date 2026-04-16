// src/components/ProfilePicture/ProfilePicture.jsx

import { useRef } from 'react';
import './ProfilePicture.css';

/** Compress an image File to a base64 JPEG ~30 KB */
async function compressToBase64(file, targetKB = 30) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX = 256;
            let { width: w, height: h } = img;
            if (w > h) { h = Math.round((h / w) * MAX); w = MAX; }
            else        { w = Math.round((w / h) * MAX); h = MAX; }
            canvas.width  = w;
            canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);

            // Binary-search quality until under target size
            let lo = 0.05, hi = 0.92, result = '';
            for (let i = 0; i < 12; i++) {
                const mid = (lo + hi) / 2;
                result = canvas.toDataURL('image/jpeg', mid);
                const sizeKB = (result.length * 0.75) / 1024;
                if (sizeKB > targetKB) hi = mid;
                else                   lo = mid;
            }
            resolve(result);
        };
        img.src = URL.createObjectURL(file);
    });
}

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
        const b64 = await compressToBase64(file, 30);
        onUpload?.(b64);
        e.target.value = '';
    };

    return (
        <div
            className={`pfp-wrap ${editable ? 'pfp-editable' : ''} ${className}`}
            style={{ width: size, height: size, borderRadius: size * 0.12 }}
            onClick={() => editable && inputRef.current?.click()}
            title={editable ? 'Click to change picture' : username}
        >
            {src ? (
                <img src={src} alt={username} className="pfp-img" draggable={false} />
            ) : (
                <div className="pfp-initials" style={{ fontSize: size * 0.32 }}>
                    {initials || '?'}
                </div>
            )}

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