/** Largest photo a player can pick. It is shrunk before upload, so it never reaches the server at this size. */
export const MAX_AVATAR_FILE_BYTES = 5 * 1024 * 1024;

/** Longest side of the uploaded image: twice the largest avatar shown, so it stays sharp on high-DPI screens. */
export const AVATAR_MAX_SIDE = 256;

/** Dimensions that fit inside maxSide, keeping the shape. Images already small enough are left alone. */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That image could not be read. Please try a JPG, PNG or GIF.'));
    };
    image.src = url;
  });
}

/**
 * Shrink a picked image to a data URL small enough for the upload limit. WebP keeps transparency;
 * browsers that can't write it return PNG instead. An animated GIF becomes its first frame.
 */
export async function shrinkAvatar(file: File): Promise<string> {
  const image = await loadImage(file);
  const { width, height } = fitWithin(image.naturalWidth, image.naturalHeight, AVATAR_MAX_SIDE);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not prepare this image.');
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/webp', 0.85);
}

/** A readable message for a failed upload. Limits such as a 413 reply in plain text, not JSON. */
export async function uploadErrorMessage(response: Pick<Response, 'status' | 'text'>): Promise<string> {
  if (response.status === 413) return 'That image is too large. Please choose a smaller one.';
  try {
    return JSON.parse(await response.text())?.error || 'Upload failed';
  } catch {
    return 'Upload failed';
  }
}
