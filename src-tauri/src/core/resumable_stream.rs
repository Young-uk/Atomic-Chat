//! Dstar's opt-in stream retention protocol. Reconnection attaches to the same
//! generation at a byte cursor; it must never replay a partially executed turn.
use super::{aborted, shared_stream_client, take_complete_utf8, HttpStreamChunk};
use futures_util::StreamExt;
use std::{collections::HashMap, time::Duration};
use tauri::ipc::Channel;
use tokio_util::sync::CancellationToken;

fn stream_base(url: &str, body: &str) -> Option<String> {
    let parsed = reqwest::Url::parse(url).ok()?;
    if !matches!(parsed.host_str(), Some("127.0.0.1" | "localhost"))
        || !parsed.path().ends_with("/v1/chat/completions")
        || serde_json::from_str::<serde_json::Value>(body).ok()?["stream"] != true
    {
        return None;
    }
    Some(format!("{}/atomic/streams", url.strip_suffix("/chat/completions")?))
}

fn has_done_event(bytes: &[u8]) -> bool {
    [b"data: [DONE]\n\n".as_slice(), b"data: [DONE]\r\n\r\n".as_slice()]
        .iter().any(|marker| bytes.windows(marker.len()).enumerate()
            .any(|(index, part)| part == *marker && (index == 0 || bytes[index - 1] == b'\n')))
}

async fn cancel_remote(client: &reqwest::Client, endpoint: &str) {
    // Stop is an explicit action, unlike dropping a transient TCP connection.
    let _ = client.delete(endpoint).timeout(Duration::from_secs(3)).send().await;
}

async fn backoff(cancel: &CancellationToken, attempts: u32) -> Result<(), String> {
    let seconds = 1u64 << attempts.min(6);
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(aborted()),
        _ = tokio::time::sleep(Duration::from_secs(seconds)) => Ok(()),
    }
}

pub(super) async fn try_stream(
    url: &str,
    headers: &HashMap<String, String>,
    body: &str,
    cancel: &CancellationToken,
    on_chunk: &Channel<HttpStreamChunk>,
    wait_for_capability: bool,
) -> Option<Result<u16, String>> {
    let base = stream_base(url, body)?;
    // A standard OpenAI-compatible server remains on its existing transport.
    let client = shared_stream_client(15);
    let mut attempts = 0;
    loop {
        let probe = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Some(Err(aborted())),
            response = client.get(&base).timeout(Duration::from_secs(3)).send() => response,
        };
        match probe {
            Ok(response) => {
                if !response.status().is_success()
                    || response.json::<serde_json::Value>().await.ok()?["version"] != 1
                { return None; }
                break;
            }
            Err(_) if wait_for_capability => {
                if let Err(error) = backoff(cancel, attempts).await { return Some(Err(error)); }
                attempts = attempts.saturating_add(1);
            }
            Err(_) => return None,
        }
    }
    let endpoint = format!("{base}/{}", uuid::Uuid::new_v4());
    let result = resume(&client, &endpoint, headers, body, cancel, on_chunk).await;
    if result.is_err() {
        cancel_remote(&client, &endpoint).await;
    }
    Some(result)
}

async fn resume(
    client: &reqwest::Client,
    endpoint: &str,
    headers: &HashMap<String, String>,
    body: &str,
    cancel: &CancellationToken,
    on_chunk: &Channel<HttpStreamChunk>,
) -> Result<u16, String> {
    let mut cursor = 0u64;
    let mut attached = false;
    let mut attempts = 0;
    let mut pending = Vec::new();
    let mut ending = Vec::new();
    loop {
        if cancel.is_cancelled() { return Err(aborted()); }
        let mut request = if attached {
            client.get(format!("{endpoint}/{cursor}"))
        } else {
            // Repeated POSTs share the same immutable ID. A lost first header
            // therefore cannot create a second generation.
            client.post(endpoint).body(body.to_owned())
        };
        for (key, value) in headers { request = request.header(key, value); }
        // Inference has no whole-response deadline; headers and each read
        // have independent inactivity bounds.
        let sent = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(aborted()),
            value = tokio::time::timeout(Duration::from_secs(15), request.send()) => value,
        };
        if let Ok(Ok(response)) = sent {
            let status = response.status();
            if status.is_success() {
                attached = true;
                let mut stream = response.bytes_stream();
                loop {
                    let next = tokio::select! {
                        biased;
                        _ = cancel.cancelled() => return Err(aborted()),
                        value = tokio::time::timeout(Duration::from_secs(30), stream.next()) => value,
                    };
                    let Ok(Some(Ok(bytes))) = next else { break };
                    cursor += bytes.len() as u64;
                    attempts = 0;
                    ending.extend_from_slice(&bytes);
                    let completed = has_done_event(&ending);
                    if ending.len() > 32 { ending.drain(..ending.len() - 32); }
                    pending.extend_from_slice(&bytes);
                    let data = take_complete_utf8(&mut pending);
                    if !data.is_empty() {
                        on_chunk.send(HttpStreamChunk { data, done: false })
                            .map_err(|_| "Stream receiver closed".to_owned())?;
                    }
                    if completed {
                        on_chunk.send(HttpStreamChunk { data: String::new(), done: true })
                            .map_err(|_| "Stream receiver closed".to_owned())?;
                        return Ok(200);
                    }
                }
            } else {
                // Missing/expired streams and request conflicts are not network
                // outages. Do not silently rerun tools or partial answers.
                return Err(format!("HTTP {}: {}", status.as_u16(), response.text().await.unwrap_or_default()));
            }
        }
        log::info!("[stream] reconnecting retained generation at byte {cursor}");
        backoff(cancel, attempts).await?;
        attempts = attempts.saturating_add(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[test]
    fn only_a_complete_done_event_ends_the_stream() {
        assert!(!has_done_event(b"data: {\"text\":\"data: [DONE]\"}\n\n"));
        assert!(!has_done_event(b"data: [DONE]\n"));
        assert!(has_done_event(b"data: [DONE]\n\n"));
        assert!(has_done_event(b"\ndata: [DONE]\r\n\r\n"));
    }

    #[tokio::test]
    async fn interrupted_utf8_and_tool_data_resume_without_reposting() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}/v1/atomic/streams/test", listener.local_addr().unwrap());
        let full = "data: {\"delta\":\"한글\",\"tool\":\"call_1\"}\n\ndata: [DONE]\n\n".as_bytes();
        let split = full.iter().position(|b| *b == 0xed).unwrap() + 1;
        let first = full[..split].to_vec();
        let second = full[split..].to_vec();
        let server = tokio::spawn(async move {
            for (index, data) in [first, second].into_iter().enumerate() {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = vec![0; 8192];
                let n = socket.read(&mut request).await.unwrap();
                let request = String::from_utf8_lossy(&request[..n]);
                if index == 0 { assert!(request.starts_with("POST ")); }
                else { assert!(request.starts_with(&format!("GET /v1/atomic/streams/test/{split} "))); }
                socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n").await.unwrap();
                socket.write_all(&data).await.unwrap();
            }
        });
        let (tx, rx) = std::sync::mpsc::channel();
        let channel = Channel::new(move |message| {
            let value = message.deserialize::<serde_json::Value>().unwrap();
            tx.send(value).unwrap(); Ok(())
        });
        let result = resume(&shared_stream_client(5), &endpoint, &HashMap::new(), "{}", &CancellationToken::new(), &channel).await;
        assert_eq!(result, Ok(200));
        server.await.unwrap();
        let messages: Vec<_> = rx.try_iter().collect();
        let text: String = messages.iter().filter_map(|m| m["data"].as_str()).collect();
        assert_eq!(text.as_bytes(), full);
        assert_eq!(messages.iter().filter(|m| m["done"] == true).count(), 1);
    }

    #[tokio::test]
    async fn lost_generation_is_not_replayed_after_server_restart() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("http://{}/v1/atomic/streams/test", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0; 4096]; let _ = socket.read(&mut request).await;
            socket.write_all(b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\ndata: partial\n\n").await.unwrap();
            drop(socket);
            let (mut socket, _) = listener.accept().await.unwrap();
            let n = socket.read(&mut request).await.unwrap();
            assert!(String::from_utf8_lossy(&request[..n]).starts_with("GET "));
            socket.write_all(b"HTTP/1.1 410 Gone\r\nContent-Length: 4\r\n\r\ngone").await.unwrap();
        });
        let channel = Channel::new(|_| Ok(()));
        let result = resume(&shared_stream_client(5), &endpoint, &HashMap::new(), "{}", &CancellationToken::new(), &channel).await;
        assert!(result.unwrap_err().starts_with("HTTP 410:"));
        server.await.unwrap();
    }
    #[test]
    fn only_local_streaming_chat_uses_the_protocol() {
        assert!(stream_base("http://127.0.0.1:8010/v1/chat/completions", r#"{"stream":true}"#).is_some());
        assert!(stream_base("https://example.com/v1/chat/completions", r#"{"stream":true}"#).is_none());
        assert!(stream_base("http://localhost:8010/v1/chat/completions", r#"{"stream":false}"#).is_none());
    }
    #[tokio::test]
    async fn manual_stop_interrupts_reconnection_wait() {
        let cancel = CancellationToken::new(); cancel.cancel();
        assert!(backoff(&cancel, 6).await.is_err());
    }
}
