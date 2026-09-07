import { validateRoom } from "./model";
import type { Room } from "./model";
const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("echo-cartographer", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("workspace");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
export async function loadRoom(): Promise<Room | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db
      .transaction("workspace")
      .objectStore("workspace")
      .get("room");
    request.onsuccess = () => {
      try {
        resolve(request.result ? validateRoom(request.result) : undefined);
      } catch (e) {
        reject(e);
      } finally {
        db.close();
      }
    };
    request.onerror = () => {
      reject(request.error);
      db.close();
    };
  });
}
export async function saveRoom(room: Room) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("workspace", "readwrite");
    tx.objectStore("workspace").put(room, "room");
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
export function download(
  name: string,
  data: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function imageData(
  file: File,
): Promise<{ image: string; width: number; height: number }> {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 20_000_000
  )
    throw new Error("Use a PNG, JPEG, or WebP image smaller than 20 MB.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return {
    image: canvas.toDataURL("image/webp", 0.9),
    width: canvas.width,
    height: canvas.height,
  };
}
