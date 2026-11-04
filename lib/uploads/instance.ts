import "server-only";
import { uploadTmpDir } from "@/lib/api/config";
import { UploadStore } from "./store";

let store: UploadStore | null = null;
export function getUploadStore(): UploadStore {
  if (!store) store = new UploadStore(uploadTmpDir());
  return store;
}
