use futures_util::{stream, StreamExt, TryStreamExt};
use reqwest::{
    header::{HeaderMap, HeaderName, HeaderValue, CONTENT_RANGE, RANGE},
    Client, StatusCode,
};
use serde::Serialize;
use std::{collections::HashMap, path::{Path, PathBuf}, time::Duration};
use tokio::{fs, io::{AsyncReadExt, AsyncWriteExt}};

#[derive(Debug, Serialize)]
pub struct DownloadResult {
    pub path: String,
    pub bytes: u64,
    pub ranged: bool,
    pub connections: usize,
}

fn build_headers(values: Option<HashMap<String, String>>) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    if let Some(values) = values {
        for (name, value) in values {
            let name = HeaderName::from_bytes(name.as_bytes()).map_err(|e| e.to_string())?;
            let value = HeaderValue::from_str(&value).map_err(|e| e.to_string())?;
            headers.insert(name, value);
        }
    }
    Ok(headers)
}

fn temp_path(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

/// Downloads a direct HTTP(S) URL. Servers that support byte ranges are fetched
/// concurrently into temporary segment files; other servers use a single stream.
#[tauri::command]
pub async fn download_url_multithread(
    url: String,
    output_path: String,
    headers: Option<HashMap<String, String>>,
    connections: Option<usize>,
) -> Result<DownloadResult, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("Invalid download URL: {e}"))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Only HTTP and HTTPS download URLs are supported".into());
    }

    let output = PathBuf::from(&output_path);
    let parent = output.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;

    let base_headers = build_headers(headers)?;
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(0))
        .build()
        .map_err(|e| e.to_string())?;
    let connection_count = connections.unwrap_or(4).clamp(2, 16);

    let probe = client.get(parsed.clone())
        .headers(base_headers.clone())
        .header(RANGE, "bytes=0-0")
        .send().await.map_err(|e| format!("Range probe failed: {e}"))?;

    let total_size = probe.headers().get(CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.rsplit('/').next())
        .and_then(|v| v.parse::<u64>().ok());
    let supports_ranges = probe.status() == StatusCode::PARTIAL_CONTENT && total_size.is_some();
    drop(probe);

    let temp_output = temp_path(&output, ".netmount-download.tmp");
    let _ = fs::remove_file(&temp_output).await;

    if supports_ranges {
        let total = total_size.unwrap();
        let parts = connection_count.min(((total + 1_048_575) / 1_048_576).max(1) as usize);
        let chunk_size = (total + parts as u64 - 1) / parts as u64;
        let ranges: Vec<(usize, u64, u64)> = (0..parts).filter_map(|index| {
            let start = index as u64 * chunk_size;
            if start >= total { return None; }
            Some((index, start, (start + chunk_size - 1).min(total - 1)))
        }).collect();

        let downloaded = stream::iter(ranges.into_iter().map(|(index, start, end)| {
            let client = client.clone();
            let url = parsed.clone();
            let headers = base_headers.clone();
            let part_path = temp_path(&output, &format!(".netmount-part-{index}.tmp"));
            async move {
                let response = client.get(url).headers(headers)
                    .header(RANGE, format!("bytes={start}-{end}"))
                    .send().await.map_err(|e| format!("Segment {index} request failed: {e}"))?;
                if response.status() != StatusCode::PARTIAL_CONTENT {
                    return Err(format!("Server stopped honoring byte ranges (segment {index})"));
                }
                let bytes = response.bytes().await.map_err(|e| e.to_string())?;
                if bytes.len() as u64 != end - start + 1 {
                    return Err(format!("Segment {index} length mismatch"));
                }
                fs::write(&part_path, &bytes).await.map_err(|e| e.to_string())?;
                Ok::<(usize, PathBuf), String>((index, part_path))
            }
        })).buffer_unordered(connection_count).try_collect::<Vec<_>>().await;

        match downloaded {
            Ok(mut files) => {
                files.sort_by_key(|(index, _)| *index);
                let mut target = fs::File::create(&temp_output).await.map_err(|e| e.to_string())?;
                for (_, part_path) in &files {
                    let mut part = fs::File::open(part_path).await.map_err(|e| e.to_string())?;
                    tokio::io::copy(&mut part, &mut target).await.map_err(|e| e.to_string())?;
                    let _ = fs::remove_file(part_path).await;
                }
                target.flush().await.map_err(|e| e.to_string())?;
                let actual = target.metadata().await.map_err(|e| e.to_string())?.len();
                if actual != total {
                    let _ = fs::remove_file(&temp_output).await;
                    return Err(format!("Downloaded size mismatch: expected {total}, got {actual}"));
                }
                drop(target);
                if fs::try_exists(&output).await.unwrap_or(false) {
                    fs::remove_file(&output).await.map_err(|e| e.to_string())?;
                }
                fs::rename(&temp_output, &output).await.map_err(|e| e.to_string())?;
                return Ok(DownloadResult { path: output_path, bytes: total, ranged: true, connections: files.len() });
            }
            Err(error) => {
                let _ = fs::remove_file(&temp_output).await;
                for index in 0..parts {
                    let _ = fs::remove_file(temp_path(&output, &format!(".netmount-part-{index}.tmp"))).await;
                }
                // Range support can be inconsistent on some providers. Retry once as a normal stream.
                if !error.contains("stopped honoring byte ranges") {
                    return Err(error);
                }
            }
        }
    }

    let response = client.get(parsed).headers(base_headers).send().await
        .map_err(|e| format!("Download request failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Download failed with HTTP {}", response.status()));
    }
    let expected = response.content_length();
    let mut source = response.bytes_stream();
    let mut target = fs::File::create(&temp_output).await.map_err(|e| e.to_string())?;
    let mut written = 0u64;
    while let Some(chunk) = source.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        target.write_all(&chunk).await.map_err(|e| e.to_string())?;
        written += chunk.len() as u64;
    }
    target.flush().await.map_err(|e| e.to_string())?;
    drop(target);
    if let Some(expected) = expected {
        if expected != written {
            let _ = fs::remove_file(&temp_output).await;
            return Err(format!("Downloaded size mismatch: expected {expected}, got {written}"));
        }
    }
    if fs::try_exists(&output).await.unwrap_or(false) {
        fs::remove_file(&output).await.map_err(|e| e.to_string())?;
    }
    fs::rename(&temp_output, &output).await.map_err(|e| e.to_string())?;
    Ok(DownloadResult { path: output_path, bytes: written, ranged: false, connections: 1 })
}
