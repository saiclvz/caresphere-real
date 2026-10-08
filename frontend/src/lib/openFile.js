import { api } from '../api/client';

/**
 * Opens a permission-checked file (adoption documents) in a new tab. The tab is opened first
 * so pop-up blockers allow it, then filled once the authorized request returns.
 */
export async function openFileInNewTab(path, headers = {}) {
  const win = window.open('', '_blank');
  try {
    const res = await api(path, { raw: true, headers });
    const url = URL.createObjectURL(await res.blob());
    if (win) win.location.href = url; else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    if (win) win.close();
    throw err;
  }
}

/** Downloads a permission-checked file (the server decides whether downloading is allowed). */
export async function downloadFile(path, filename, headers = {}) {
  const res = await api(path, { raw: true, headers });
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
