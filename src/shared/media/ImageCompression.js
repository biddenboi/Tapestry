/**
 * Compresses an image File to a base64 JPEG under `targetKB` kilobytes.
 *
 * @param {File}   file      - The image file to compress.
 * @param {number} targetKB  - Maximum output size in kilobytes.
 * @param {number} maxDim    - Longest edge is capped to this pixel count.
 * @returns {Promise<string>} Base64 data-URL of the compressed JPEG.
 */
export async function compressImageToBase64(file, targetKB = 150, maxDim = 1200) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        let { width: w, height: h } = img;

        // Scale down so the longest edge is no larger than maxDim.
        if (w > h) {
          if (w > maxDim) { h = Math.round((h / w) * maxDim); w = maxDim; }
        } else if (h > maxDim) {
          w = Math.round((w / h) * maxDim);
          h = maxDim;
        }

        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);

        // Binary-search JPEG quality until output is under targetKB.
        let lo = 0.05, hi = 0.92, result = '';
        for (let i = 0; i < 12; i++) {
          const mid = (lo + hi) / 2;
          result = canvas.toDataURL('image/jpeg', mid);
          const sizeKB = (result.length * 0.75) / 1024;
          if (sizeKB > targetKB) hi = mid;
          else                   lo = mid;
        }
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Unable to read image: ${file.name || 'unknown file'}`));
    };
    img.src = objectUrl;
  });
}
