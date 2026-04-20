import { useRef, useState, useCallback, useEffect } from 'react';
import './MarkdownEditor.css';

// ── Token parser ─────────────────────────────────────────
function parseTokens(text) {
    const tokens = [];
    let i = 0;

    while (i < text.length) {
        // Heading (start of line)
        if (i === 0 || text[i - 1] === '\n') {
            const match = text.slice(i).match(/^(#{1,3}) (.+?)(?=\n|$)/);
            if (match) {
                const raw = match[0];
                tokens.push({
                    type: 'heading', raw,
                    level: match[1].length,
                    content: match[2],
                    start: i, end: i + raw.length,
                });
                i += raw.length;
                continue;
            }
        }

        // Bold **text** (before italic check)
        if (text[i] === '*' && text[i + 1] === '*') {
            const closeIdx = text.indexOf('**', i + 2);
            if (closeIdx !== -1 && !text.slice(i + 2, closeIdx).includes('\n')) {
                const raw = text.slice(i, closeIdx + 2);
                tokens.push({ type: 'bold', raw, content: raw.slice(2, -2), start: i, end: closeIdx + 2 });
                i = closeIdx + 2;
                continue;
            }
        }

        // Italic *text*
        if (text[i] === '*' && text[i + 1] !== '*') {
            const closeIdx = text.indexOf('*', i + 1);
            if (closeIdx !== -1 && text[closeIdx + 1] !== '*' && !text.slice(i + 1, closeIdx).includes('\n')) {
                const raw = text.slice(i, closeIdx + 1);
                tokens.push({ type: 'italic', raw, content: raw.slice(1, -1), start: i, end: closeIdx + 1 });
                i = closeIdx + 1;
                continue;
            }
        }

        // Code `code`
        if (text[i] === '`') {
            const closeIdx = text.indexOf('`', i + 1);
            if (closeIdx !== -1) {
                const raw = text.slice(i, closeIdx + 1);
                tokens.push({ type: 'code', raw, content: raw.slice(1, -1), start: i, end: closeIdx + 1 });
                i = closeIdx + 1;
                continue;
            }
        }

        // Link [text](url)
        if (text[i] === '[') {
            const closeBracket = text.indexOf(']', i);
            if (closeBracket !== -1 && text[closeBracket + 1] === '(') {
                const closeParen = text.indexOf(')', closeBracket + 2);
                if (closeParen !== -1) {
                    const raw = text.slice(i, closeParen + 1);
                    tokens.push({
                        type: 'link', raw,
                        content: text.slice(i + 1, closeBracket),
                        url: text.slice(closeBracket + 2, closeParen),
                        start: i, end: closeParen + 1,
                    });
                    i = closeParen + 1;
                    continue;
                }
            }
        }

        // Newline
        if (text[i] === '\n') {
            tokens.push({ type: 'newline', raw: '\n', start: i, end: i + 1 });
            i++;
            continue;
        }

        // Plain text — accumulate until next special char or newline
        let j = i + 1;
        while (j < text.length && !/[*`[\n#]/.test(text[j])) j++;
        // Don't break mid-word on #
        tokens.push({ type: 'text', raw: text.slice(i, j), start: i, end: j });
        i = j;
    }

    return tokens;
}

function esc(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// ── Build overlay HTML ────────────────────────────────────
// cursorPos = current selectionStart in textarea
// When cursor is INSIDE a token's range, show raw; otherwise show formatted.
function buildMirrorHTML(tokens, cursorPos) {
    return tokens.map(token => {
        const active = cursorPos >= token.start && cursorPos <= token.end;

        switch (token.type) {
            case 'text':
                return `<span>${esc(token.raw)}</span>`;
            case 'newline':
                return '<br>';
            case 'heading': {
                const prefix = '#'.repeat(token.level) + ' ';
                if (active) return `<span class="md-raw md-h${token.level}">${esc(prefix)}${esc(token.content)}</span>`;
                return `<span class="md-h${token.level}">${esc(token.content)}</span>`;
            }
            case 'bold':
                if (active) return `<strong class="md-raw">${esc('**')}${esc(token.content)}${esc('**')}</strong>`;
                return `<strong>${esc(token.content)}</strong>`;
            case 'italic':
                if (active) return `<em class="md-raw">${esc('*')}${esc(token.content)}${esc('*')}</em>`;
                return `<em>${esc(token.content)}</em>`;
            case 'code':
                if (active) return `<code class="md-raw">${esc('`')}${esc(token.content)}${esc('`')}</code>`;
                return `<code>${esc(token.content)}</code>`;
            case 'link':
                if (active) return `<span class="md-raw">${esc(token.raw)}</span>`;
                return `<a class="md-link" href="${esc(token.url)}" target="_blank" rel="noopener noreferrer" tabindex="-1">${esc(token.content)}</a>`;
            default:
                return esc(token.raw);
        }
    }).join('');
}

// ── Build read-only formatted HTML (for blur preview) ────
function buildPreviewHTML(tokens) {
    return tokens.map(token => {
        switch (token.type) {
            case 'text':   return `<span>${esc(token.raw)}</span>`;
            case 'newline': return '<br>';
            case 'heading': return `<span class="md-h${token.level}">${esc(token.content)}</span>`;
            case 'bold':    return `<strong>${esc(token.content)}</strong>`;
            case 'italic':  return `<em>${esc(token.content)}</em>`;
            case 'code':    return `<code>${esc(token.content)}</code>`;
            case 'link':
                return `<a class="md-link" href="${esc(token.url)}" target="_blank" rel="noopener noreferrer">${esc(token.content)}</a>`;
            default: return esc(token.raw);
        }
    }).join('');
}

// ── Component ─────────────────────────────────────────────
export default function MarkdownEditor({ value = '', onChange, placeholder, className = '', readOnly = false }) {
    const textareaRef = useRef(null);
    const mirrorRef = useRef(null);
    const [focused, setFocused] = useState(false);
    const [cursorPos, setCursorPos] = useState(0);

    // Update mirror content whenever value or cursor changes
    useEffect(() => {
        if (!mirrorRef.current || !focused) return;
        const tokens = parseTokens(value);
        mirrorRef.current.innerHTML = buildMirrorHTML(tokens, cursorPos);
    }, [value, cursorPos, focused]);

    // Sync textarea scroll to mirror
    const syncScroll = useCallback(() => {
        if (mirrorRef.current && textareaRef.current) {
            mirrorRef.current.scrollTop = textareaRef.current.scrollTop;
        }
    }, []);

    const handleChange = (e) => {
        onChange?.(e.target.value);
        setCursorPos(e.target.selectionStart);
    };

    const handleSelect = () => {
        if (textareaRef.current) setCursorPos(textareaRef.current.selectionStart);
    };

    const handleFocus = () => {
        setFocused(true);
        if (textareaRef.current) setCursorPos(textareaRef.current.selectionStart);
    };

    const handleBlur = () => {
        // Small delay to allow clicking links in preview
        setTimeout(() => setFocused(false), 150);
    };

    // Handle link clicks in the preview (non-focused) div
    const handlePreviewClick = (e) => {
        const link = e.target.closest('a.md-link');
        if (link) {
            e.preventDefault();
            e.stopPropagation();
            const url = link.getAttribute('href');
            if (url) {
                // Electron: open in system browser via shell
                try {
                    if (window.require) {
                        const { shell } = window.require('electron');
                        shell.openExternal(url);
                        return;
                    }
                } catch (_) { /* not in Electron */ }
                // Browser fallback
                window.open(url, '_blank', 'noopener,noreferrer');
            }
            return;
        }
        // Otherwise focus the textarea
        textareaRef.current?.focus();
    };

    const tokens = parseTokens(value);
    const previewHTML = buildPreviewHTML(tokens);

    if (readOnly) {
        return (
            <div
                className={`md-editor readonly ${className}`}
                dangerouslySetInnerHTML={{ __html: previewHTML }}
                onClick={handlePreviewClick}
            />
        );
    }

    return (
        <div className={`md-editor-wrap ${className} ${focused ? 'focused' : ''}`}>
            {/* Mirror layer — shown while editing */}
            {focused && (
                <div
                    ref={mirrorRef}
                    className="md-mirror"
                    aria-hidden="true"
                />
            )}

            {/* Preview layer — shown when not focused */}
            {!focused && (
                <div
                    className="md-preview"
                    dangerouslySetInnerHTML={{ __html: previewHTML || `<span class="md-placeholder">${placeholder || ''}</span>` }}
                    onClick={handlePreviewClick}
                />
            )}

            {/* Transparent textarea — always present for editing */}
            <textarea
                ref={textareaRef}
                value={value}
                onChange={handleChange}
                onSelect={handleSelect}
                onKeyUp={handleSelect}
                onMouseUp={handleSelect}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onScroll={syncScroll}
                placeholder={focused ? placeholder : ''}
                className={`md-textarea ${focused ? 'visible' : 'hidden'}`}
                spellCheck="true"
                readOnly={readOnly}
            />
        </div>
    );
}
