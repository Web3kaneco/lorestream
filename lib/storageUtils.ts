import { ref, uploadString, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from './firebase';

/**
 * Upload a base64-encoded image to Firebase Storage.
 * Accepts both raw base64 and data URL format (data:image/png;base64,...).
 * Returns the public download URL.
 */
export async function uploadBase64Image(
  userId: string,
  base64Data: string,
  filename?: string
): Promise<string> {
  const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
  const name = filename || `${Date.now()}_generated.png`;
  const storageRef = ref(storage, `users/${userId}/vault/${name}`);
  await uploadString(storageRef, cleanBase64, 'base64', {
    contentType: 'image/png',
  });
  return getDownloadURL(storageRef);
}

/**
 * Upload a raw File to Firebase Storage.
 * Returns the public download URL.
 */
export async function uploadFileToStorage(
  userId: string,
  file: File
): Promise<string> {
  const name = `${Date.now()}_${file.name}`;
  const storageRef = ref(storage, `users/${userId}/uploads/${name}`);
  await uploadBytes(storageRef, file, { contentType: file.type });
  return getDownloadURL(storageRef);
}
