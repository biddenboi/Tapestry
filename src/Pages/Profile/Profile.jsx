import { useParams } from "react-router-dom";
import { AppContext } from "../../App";
import { useState, useEffect, useContext, useRef } from "react";
import './Profile.css';
import { STORES } from '../../utils/Constants.js'
import { UTCStringToLocalDate, UTCStringToLocalTime, formatDuration } from "../../utils/Helpers/Time";
import JournalPopup from "../../Modals/JournalPopup/JournalPopup";
import NiceModal from '@ebay/nice-modal-react';
import { getTaskDuration } from '../../utils/Helpers/Tasks.js'

const TARGET_PROFILE_PIC_BYTES = 30 * 1024;
const DEFAULT_AVATAR_BG = '#0b1220';

function bytesFromDataUrl(dataUrl) {
    const base64 = dataUrl.split(',')[1] || '';
    return Math.ceil((base64.length * 3) / 4);
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

async function decodeImageFile(file) {
    if (window.createImageBitmap) {
        try {
            return await createImageBitmap(file);
        } catch (_) {
            // Fallback below
        }
    }

    const dataUrl = await blobToDataUrl(file);

    return await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('The selected image could not be decoded by the browser.'));
        img.src = dataUrl;
    });
}

async function compressProfilePicture(file, targetBytes = TARGET_PROFILE_PIC_BYTES) {
    const source = await decodeImageFile(file);

    const sourceWidth = source.width;
    const sourceHeight = source.height;
    const cropSize = Math.min(sourceWidth, sourceHeight);
    const cropX = (sourceWidth - cropSize) / 2;
    const cropY = (sourceHeight - cropSize) / 2;

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { alpha: false });

    const dimensions = [512, 448, 384, 320, 256, 224, 192, 160];
    const qualities = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5, 0.42, 0.35];

    let best = null;

    for (const size of dimensions) {
        canvas.width = size;
        canvas.height = size;

        context.fillStyle = DEFAULT_AVATAR_BG;
        context.fillRect(0, 0, size, size);
        context.drawImage(
            source,
            cropX, cropY, cropSize, cropSize,
            0, 0, size, size
        );

        for (const quality of qualities) {
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
            if (!blob) continue;

            const dataUrl = await blobToDataUrl(blob);
            const bytes = bytesFromDataUrl(dataUrl);

            if (!best || bytes < best.bytes) {
                best = { dataUrl, bytes };
            }

            if (bytes <= targetBytes) {
                if (typeof source.close === 'function') source.close();
                return { dataUrl, bytes };
            }
        }
    }

    if (typeof source.close === 'function') source.close();
    return best;
}

function HistoryItem({ element }) {
    const type = element.type;
    const iconMap = { task: "TSK", journal: "JNL", event: "EVT", transaction: "TXN" };

    const title = element.taskName ?? element.title ?? element.description ?? element.name ?? "—";
    const time = UTCStringToLocalTime(element.createdAt);

    let subtitle = type;
    if (type === "task") {
        const dur = formatDuration(element.duration);
        if (dur) subtitle += ` · ${dur}`;
    } else if (type === "journal" && element.entry) {
        subtitle += ` · ${element.entry.slice(0, 40)}${element.entry.length > 40 ? "…" : ""}`;
    } else if (type === "event" && element.type) {
        subtitle += ` · ${element.type}`;
    } else if (type === "transaction" && element.location) {
        subtitle += ` · ${element.location}`;
    }

    const pts = type === "task" && element.points > 0 ? `+${element.points} pts`
        : type === "transaction" && element.cost ? `−${element.cost} tokens`
        : null;

    return (
        <div className="history-item">
            <div className="history-item-left">
                <div className={`history-item-icon history-item-icon--${type}`}>
                    {iconMap[type]}
                </div>
                <div className="history-item-body">
                    <span className="history-item-name">{title}</span>
                    <span className="history-item-sub">{subtitle}</span>
                </div>
            </div>
            <div className="history-item-right">
                {pts && <span className="history-item-pts">{pts}</span>}
                <span className="history-item-time">{time}</span>
            </div>
        </div>
    );
}

function Profile() {
    const databaseConnection = useContext(AppContext).databaseConnection;
    const timestamp = useContext(AppContext).timestamp;
    const { index } = useParams();

    const [player, setPlayer] = useState(null);
    const [uploadState, setUploadState] = useState({ busy: false, message: '' });
    const fileInputRef = useRef(null);

    const migrateLegacyAvatarIfNeeded = async (playerRecord) => {
        if (!playerRecord?.profilePicture) {
            return await databaseConnection.get(STORES.avatar, playerRecord?.UUID);
        }

        const now = new Date().toISOString();
        const existingAvatar = await databaseConnection.get(STORES.avatar, playerRecord.UUID);

        if (!existingAvatar) {
            await databaseConnection.add(STORES.avatar, {
                UUID: playerRecord.UUID,
                parent: playerRecord.UUID,
                dataUrl: playerRecord.profilePicture,
                mimeType: 'image/jpeg',
                byteSize: playerRecord.profilePictureBytes || bytesFromDataUrl(playerRecord.profilePicture),
                createdAt: playerRecord.profilePictureUpdatedAt || now,
                updatedAt: playerRecord.profilePictureUpdatedAt || now,
            });
        }

        const {
            profilePicture,
            profilePictureBytes,
            profilePictureUpdatedAt,
            ...cleanedPlayer
        } = playerRecord;

        await databaseConnection.add(STORES.player, cleanedPlayer);
        return await databaseConnection.get(STORES.avatar, playerRecord.UUID);
    };

    useEffect(() => {
        const getPlayer = async () => {
            const p = await databaseConnection.get(STORES.player, index);
            if (!p) {
                setPlayer(null);
                return;
            }

            let avatar = await databaseConnection.get(STORES.avatar, p.UUID);
            if (!avatar && p.profilePicture) {
                avatar = await migrateLegacyAvatarIfNeeded(p);
            }

            const history = [];
            const tasks = await databaseConnection.getPlayerStore(STORES.task, p.UUID);
            const journals = await databaseConnection.getPlayerStore(STORES.journal, p.UUID);
            const events = await databaseConnection.getPlayerStore(STORES.event, p.UUID);

            let sum = 0;

            tasks.forEach(task => {
                if (getTaskDuration(task) == undefined) return;
                history.push({
                    ...task,
                    type: "task"
                });
                sum += (task.points || 0);
            });

            journals.forEach(journal => {
                history.push({
                    ...journal,
                    type: "journal"
                });
            });

            events.forEach(event => {
                history.push({
                    ...event,
                    type: "event"
                });
            });

            history.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

            const currentPlayer = await databaseConnection.getCurrentPlayer();

            setPlayer({
                ...p,
                points: sum,
                history,
                current: currentPlayer?.UUID === index,
                profilePicture: avatar?.dataUrl || '',
                profilePictureBytes: avatar?.byteSize || 0,
                profilePictureUpdatedAt: avatar?.updatedAt || '',
            });
        };

        getPlayer();
    }, [index, timestamp, databaseConnection]);

    const handleProfilePictureChange = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';

        if (!file || !player?.current) return;

        const unsupportedTypes = ['image/heic', 'image/heif'];
        if (!file.type.startsWith('image/')) {
            setUploadState({ busy: false, message: 'Select an image file.' });
            return;
        }

        if (unsupportedTypes.includes(file.type)) {
            setUploadState({
                busy: false,
                message: 'HEIC/HEIF is not supported here yet. Convert it to JPG, PNG, or WEBP first.',
            });
            return;
        }

        try {
            setUploadState({ busy: true, message: 'Compressing image…' });

            const compressed = await compressProfilePicture(file);
            if (!compressed?.dataUrl) {
                throw new Error('Compression failed');
            }

            const now = new Date().toISOString();

            await databaseConnection.add(STORES.avatar, {
                UUID: player.UUID,
                parent: player.UUID,
                dataUrl: compressed.dataUrl,
                mimeType: 'image/jpeg',
                byteSize: compressed.bytes,
                createdAt: player.profilePictureUpdatedAt || now,
                updatedAt: now,
            });

            setPlayer(prev => prev ? {
                ...prev,
                profilePicture: compressed.dataUrl,
                profilePictureBytes: compressed.bytes,
                profilePictureUpdatedAt: now,
            } : prev);

            setUploadState({
                busy: false,
                message: `Profile picture saved (${Math.round(compressed.bytes / 1024)}KB).`,
            });
        } catch (error) {
            console.error('Profile picture upload failed:', {
                fileName: file?.name,
                fileType: file?.type,
                fileSize: file?.size,
                error,
            });

            setUploadState({
                busy: false,
                message: 'This image could not be processed. Try JPG, PNG, or WEBP.',
            });
        }
    };

    const handleRemoveProfilePicture = async () => {
        if (!player?.current) return;

        await databaseConnection.remove(STORES.avatar, player.UUID);

        setPlayer(prev => prev ? {
            ...prev,
            profilePicture: '',
            profilePictureBytes: 0,
            profilePictureUpdatedAt: '',
        } : prev);

        setUploadState({ busy: false, message: 'Profile picture removed.' });
    };

    if (!player) return null;

    return (
        <div className="profile">
            <div className="profile-banner">
                <div className="profile-avatar-panel">
                    <div className="profile-avatar-frame">
                        {player.profilePicture ? (
                            <img
                                className="profile-avatar-image"
                                src={player.profilePicture}
                                alt={`${player.username} profile`}
                            />
                        ) : (
                            <div className="profile-avatar-fallback">
                                {(player.username || 'Guest').slice(0, 1).toUpperCase()}
                            </div>
                        )}
                        <div className="profile-avatar-ring" />
                    </div>

                    <div className="profile-avatar-meta">

                        {player.current ? (
                            <>
                                <div className="profile-avatar-actions">
                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={uploadState.busy}
                                    >
                                        {player.profilePicture ? 'Replace' : 'Upload'}
                                    </button>

                                    {player.profilePicture && (
                                        <button
                                            type="button"
                                            className="secondary-avatar-btn"
                                            onClick={handleRemoveProfilePicture}
                                            disabled={uploadState.busy}
                                        >
                                            Remove
                                        </button>
                                    )}
                                </div>

                                <input
                                    ref={fileInputRef}
                                    className="profile-avatar-input"
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp"
                                    onChange={handleProfilePictureChange}
                                />
                            </>
                        ) : (
                            <span className="profile-avatar-status">
                                Profile picture managed by this user.
                            </span>
                        )}
                    </div>
                </div>

                <div className="stats-subsection">
                    <span>{UTCStringToLocalDate(player.createdAt)}</span>
                    <span>{player.username}</span>
                    {player.description ? <span>{player.description}</span> : ""}
                </div>

                <div className="description-subsection">
                    <div>
                        <span>Points: </span>
                        <span>{player.points}</span>
                    </div>
                    <div>
                        <span>Entries: </span>
                        <span>{player.history.length}</span>
                    </div>
                    <div>
                        <span>Avatar Size: </span>
                        <span>{player.profilePictureBytes ? `${Math.round(player.profilePictureBytes / 1024)}KB` : 'None'}</span>
                    </div>
                </div>
            </div>

            <div className="history-display">
                <div className="section-header">
                    <span>Timeline</span>
                    {
                        player.current
                            ? <button onClick={() => NiceModal.show(JournalPopup)}>Entry</button>
                            : ""
                    }
                </div>

                <div className="container">
                    {player.history.map((element) => (
                        <HistoryItem
                            element={element}
                            key={element.UUID}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

export default Profile;