import { invoke } from '@tauri-apps/api/core'

export interface BackgroundDownloadResult {
  path: string
  bytes: number
  ranged: boolean
  connections: number
}

/**
 * Download a provider-supplied direct URL to a local path.
 * Pass provider authorization headers when the URL requires them.
 * The native backend automatically falls back when byte ranges are unavailable.
 */
export function downloadWithBackgroundEngine(
  url: string,
  outputPath: string,
  options: { headers?: Record<string, string>; connections?: number } = {}
): Promise<BackgroundDownloadResult> {
  return invoke<BackgroundDownloadResult>('download_url_multithread', {
    url,
    outputPath,
    headers: options.headers ?? null,
    connections: options.connections ?? 4,
  })
}
