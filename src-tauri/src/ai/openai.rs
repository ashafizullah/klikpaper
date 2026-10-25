//! OpenAI Chat Completions and compatible APIs (OpenRouter, Ollama, LM Studio, Groq...).
use super::{ChatRequest, ChatResult, Message, Part, Role, check_status, parse_tool_input, push_text, sse};
use crate::error::{AppError, AppResult};
use crate::keys;
use serde_json::{Value, json};

pub const DEFAULT_BASE: &str = "https://api.openai.com/v1";

/// Base URL for an OpenAI-compatible request.
pub fn base_url(configured: Option<&str>) -> &str {
    configured.filter(|b| !b.trim().is_empty()).unwrap_or(DEFAULT_BASE).trim_end_matches('/')
}

pub fn build_body(req: &ChatRequest) -> Value {
    let mut messages = Vec::new();
    if let Some(system) = req.system.as_deref().filter(|s| !s.is_empty()) {
        messages.push(json!({ "role": "system", "content": system }));
    }
    let gemini = is_gemini(req);
    for m in &req.messages {
        push_wire(&mut messages, m, gemini);
    }
    let mut body = json!({ "model": req.model, "stream": true, "messages": messages });
    if !req.tools.is_empty() {
        body["tools"] = req
            .tools
            .iter()
            .map(|t| {
                json!({
                    "type": "function",
                    "function": { "name": t.name, "description": t.description, "parameters": t.parameters },
                })
            })
            .collect();
    }
    if let Some(max) = req.max_tokens {
        body["max_completion_tokens"] = json!(max);
    }
    body
}

/// Gemini's endpoint rejects tool-call history without thought signatures.
fn is_gemini(req: &ChatRequest) -> bool {
    base_url(req.base_url.as_deref()).contains("generativelanguage.googleapis.com") || req.model.starts_with("gemini")
}

/// Gemini's documented placeholder for tool calls it did not produce (e.g. made by another provider).
const GEMINI_SKIP_SIGNATURE: &str = "skip_thought_signature_validator";

fn push_wire(out: &mut Vec<Value>, m: &Message, gemini: bool) {
    match m.role {
        Role::User => {
            // Tool results become `tool` messages that must directly follow the assistant turn.
            for p in &m.content {
                if let Part::ToolResult { id, content, is_error, .. } = p {
                    let content = if *is_error { format!("ERROR: {content}") } else { content.clone() };
                    out.push(json!({ "role": "tool", "tool_call_id": id, "content": content }));
                }
            }
            let mut parts = Vec::new();
            for p in &m.content {
                match p {
                    Part::Text { text } if !text.is_empty() => parts.push(json!({ "type": "text", "text": text })),
                    Part::Image { media_type, data } => parts.push(json!({
                        "type": "image_url",
                        "image_url": { "url": format!("data:{media_type};base64,{data}") },
                    })),
                    _ => {}
                }
            }
            if parts.is_empty() {
                return;
            }
            let only_text = parts.iter().all(|p| p["type"] == "text");
            let content = if only_text {
                json!(parts.iter().filter_map(|p| p["text"].as_str()).collect::<Vec<_>>().join("\n"))
            } else {
                json!(parts)
            };
            out.push(json!({ "role": "user", "content": content }));
        }
        Role::Assistant => {
            let text: String =
                m.content.iter().filter_map(|p| if let Part::Text { text } = p { Some(text.as_str()) } else { None }).collect();
            let mut calls: Vec<Value> = m
                .content
                .iter()
                .filter_map(|p| match p {
                    Part::ToolCall { id, name, input, meta } => {
                        let mut call = json!({
                            "id": id,
                            "type": "function",
                            "function": { "name": name, "arguments": input.to_string() },
                        });
                        // Echo provider extras (Gemini's thought_signature lives in extra_content).
                        if let Some(extra) = meta.as_ref().and_then(|m| m.get("extra_content")) {
                            call["extra_content"] = extra.clone();
                        }
                        Some(call)
                    }
                    _ => None,
                })
                .collect();
            // Gemini only signs the first of parallel calls; history from other providers has none.
            if gemini
                && !calls.iter().any(|c| c.pointer("/extra_content/google/thought_signature").is_some())
                && let Some(first) = calls.first_mut()
            {
                first["extra_content"] = json!({ "google": { "thought_signature": GEMINI_SKIP_SIGNATURE } });
            }
            let mut msg = json!({ "role": "assistant", "content": if text.is_empty() { Value::Null } else { json!(text) } });
            if !calls.is_empty() {
                msg["tool_calls"] = json!(calls);
            }
            out.push(msg);
        }
    }
}

#[derive(Default)]
pub struct StreamState {
    parts: Vec<Part>,
    calls: Vec<(u64, String, String, String, Option<Value>)>, // index, id, name, arguments, extra_content
    finish: Option<String>,
}

impl StreamState {
    pub fn handle(&mut self, data: &Value) -> AppResult<Option<String>> {
        if let Some(err) = data.get("error") {
            let msg = err["message"].as_str().unwrap_or("stream error");
            return Err(AppError::msg(msg.to_string()));
        }
        let Some(choice) = data["choices"].get(0) else { return Ok(None) };
        if let Some(f) = choice["finish_reason"].as_str() {
            self.finish = Some(f.to_string());
        }
        let delta = &choice["delta"];
        for tc in delta["tool_calls"].as_array().into_iter().flatten() {
            let index = tc["index"].as_u64().unwrap_or(self.calls.len() as u64);
            let pos = match self.calls.iter().position(|c| c.0 == index) {
                Some(p) => p,
                None => {
                    self.calls.push((index, String::new(), String::new(), String::new(), None));
                    self.calls.len() - 1
                }
            };
            let call = &mut self.calls[pos];
            if let Some(id) = tc["id"].as_str() {
                call.1 = id.to_string();
            }
            if let Some(name) = tc["function"]["name"].as_str() {
                call.2.push_str(name);
            }
            if let Some(args) = tc["function"]["arguments"].as_str() {
                call.3.push_str(args);
            }
            if let Some(extra) = tc.get("extra_content").filter(|v| !v.is_null()) {
                call.4 = Some(extra.clone());
            }
        }
        match delta["content"].as_str() {
            Some(t) if !t.is_empty() => {
                push_text(&mut self.parts, t);
                Ok(Some(t.to_string()))
            }
            _ => Ok(None),
        }
    }

    pub fn finish(mut self) -> ChatResult {
        let has_calls = !self.calls.is_empty();
        for (i, (_, id, name, args, extra)) in self.calls.into_iter().enumerate() {
            let id = if id.is_empty() { format!("call_{i}_{}", uuid::Uuid::new_v4().simple()) } else { id };
            let meta = extra.map(|e| json!({ "extra_content": e }));
            self.parts.push(Part::ToolCall { id, name, input: parse_tool_input(&args), meta });
        }
        let stop_reason = match self.finish.as_deref() {
            _ if has_calls => "tool_use".to_string(),
            Some("stop") | None => "end_turn".to_string(),
            Some("length") => "max_tokens".to_string(),
            Some("content_filter") => "refusal".to_string(),
            Some(other) => other.to_string(),
        };
        ChatResult { message: Message { role: Role::Assistant, content: self.parts }, stop_reason }
    }
}

pub async fn chat(client: &reqwest::Client, req: &ChatRequest, on_text: &mut (dyn FnMut(&str) + Send)) -> AppResult<ChatResult> {
    // Local servers (Ollama, LM Studio) usually need no key.
    let mut http = client
        .post(format!("{}/chat/completions", base_url(req.base_url.as_deref())))
        .header("X-Title", "KlikPaper")
        .json(&build_body(req));
    if let Some(key) = keys::get(&req.profile_id)? {
        http = http.bearer_auth(key);
    }
    let resp = check_status(http.send().await?).await?;
    let mut state = StreamState::default();
    sse::for_each_event(resp, |ev| {
        if ev.data.trim() == "[DONE]" {
            return Ok(());
        }
        let data: Value = serde_json::from_str(&ev.data)?;
        if let Some(t) = state.handle(&data)? {
            on_text(&t);
        }
        Ok(())
    })
    .await?;
    Ok(state.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_tool_call_fragments() {
        let mut s = StreamState::default();
        for e in [
            json!({"choices":[{"delta":{"content":"Ok"}}]}),
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"split_clip","arguments":"{\"at\""}}]}}]}),
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":2}"}}]}}]}),
            json!({"choices":[{"delta":{},"finish_reason":"tool_calls"}]}),
        ] {
            s.handle(&e).unwrap();
        }
        let r = s.finish();
        assert_eq!(r.stop_reason, "tool_use");
        assert!(matches!(&r.message.content[1], Part::ToolCall { id, input, .. } if id == "c1" && input["at"] == 2));
    }

    #[test]
    fn tool_results_become_tool_messages() {
        let mut out = Vec::new();
        push_wire(
            &mut out,
            &Message {
                role: Role::User,
                content: vec![Part::ToolResult { id: "c1".into(), name: "x".into(), content: "done".into(), is_error: false }],
            },
            false,
        );
        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["role"], "tool");
        assert_eq!(out[0]["tool_call_id"], "c1");
    }

    #[test]
    fn echoes_gemini_thought_signature() {
        let mut s = StreamState::default();
        s.handle(&json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","extra_content":{"google":{"thought_signature":"sig"}},"function":{"name":"list_files","arguments":"{}"}}]}}]})).unwrap();
        s.handle(&json!({"choices":[{"delta":{"tool_calls":[{"index":1,"id":"c2","function":{"name":"read_file","arguments":"{}"}}]}}]}))
            .unwrap();
        let msg = s.finish().message;
        let mut out = Vec::new();
        push_wire(&mut out, &msg, true);
        let calls = &out[0]["tool_calls"];
        assert_eq!(calls[0]["extra_content"]["google"]["thought_signature"], "sig");
        assert!(calls[1].get("extra_content").is_none());
    }

    #[test]
    fn unsigned_history_gets_placeholder_for_gemini_only() {
        let msg = Message {
            role: Role::Assistant,
            content: vec![Part::ToolCall { id: "c1".into(), name: "list_files".into(), input: json!({}), meta: None }],
        };
        let (mut g, mut o) = (Vec::new(), Vec::new());
        push_wire(&mut g, &msg, true);
        push_wire(&mut o, &msg, false);
        assert_eq!(g[0]["tool_calls"][0]["extra_content"]["google"]["thought_signature"], GEMINI_SKIP_SIGNATURE);
        assert!(o[0]["tool_calls"][0].get("extra_content").is_none());
    }
}
