// OPFS(Origin Private File System)。ブラウザ内にファイルツリーを持つ。
//
// パスは "/" 区切りの文字列で、先頭の "/" は無視して OPFS ルートからの相対として扱う。
// 意味は Tauri 版の fs コマンド(src-tauri/src/fs.rs)に揃えてある:
// listDir はファイル名だけを名前順で返し、無いディレクトリには空配列を返す。

function segments(path: string): string[] {
  return path.split("/").filter((s) => s && s !== ".");
}

function split(path: string): { parent: string; name: string } {
  const segs = segments(path);
  const name = segs.pop() ?? "";
  return { parent: segs.join("/"), name };
}

async function root(): Promise<FileSystemDirectoryHandle> {
  if (!navigator.storage?.getDirectory) {
    throw new Error("このブラウザは OPFS に対応していません。Chrome / Edge / Safari 17 以降 / Firefox 111 以降で開いてください");
  }
  return navigator.storage.getDirectory();
}

async function dirAt(path: string, create: boolean): Promise<FileSystemDirectoryHandle | null> {
  let dir = await root();
  for (const name of segments(path)) {
    try {
      dir = await dir.getDirectoryHandle(name, { create });
    } catch {
      return null; // create=false で存在しない
    }
  }
  return dir;
}

async function fileAt(path: string, create: boolean): Promise<FileSystemFileHandle | null> {
  const { parent, name } = split(path);
  if (!name) return null;
  const dir = await dirAt(parent, create);
  if (!dir) return null;
  try {
    return await dir.getFileHandle(name, { create });
  } catch {
    return null;
  }
}

export async function readText(path: string): Promise<string> {
  const h = await fileAt(path, false);
  if (!h) throw new Error(`ファイルがありません: ${path}`);
  return (await h.getFile()).text();
}

/** 無ければ null。PDF と state.sqlite に使う */
export async function readBinary(path: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const h = await fileAt(path, false);
  if (!h) return null;
  return new Uint8Array(await (await h.getFile()).arrayBuffer());
}

/** 途中のディレクトリは作る */
export async function write(path: string, data: string | Uint8Array): Promise<void> {
  const h = await fileAt(path, true);
  if (!h) throw new Error(`書き込めません: ${path}`);
  const w = await h.createWritable();
  try {
    await w.write(data as FileSystemWriteChunkType);
  } finally {
    await w.close();
  }
}

export async function exists(path: string): Promise<boolean> {
  if (await fileAt(path, false)) return true;
  return (await dirAt(path, false)) !== null;
}

export async function listDir(path: string): Promise<string[]> {
  const dir = await dirAt(path, false);
  if (!dir) return [];
  const names: string[] = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "file") names.push(name);
  }
  return names.sort();
}

export async function mkdirAll(path: string): Promise<void> {
  await dirAt(path, true);
}

export async function removeFile(path: string): Promise<void> {
  const { parent, name } = split(path);
  if (!name) return;
  const dir = await dirAt(parent, false);
  if (!dir) return;
  try {
    await dir.removeEntry(name);
  } catch {
    /* 無ければ何もしない */
  }
}
