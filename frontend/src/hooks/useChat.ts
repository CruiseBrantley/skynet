import { useState, useEffect, useRef, useCallback } from "react";
import type { ChatMessage, AuthUser, SSEPayload } from "../types";

export function useChat(user: AuthUser | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [thinkingStatus, setThinkingStatus] = useState<string | null>(null);
  const [lastSignature, setLastSignature] = useState<string>("");
  const streamingRef = useRef(false);

  useEffect(() => {
    streamingRef.current = isStreaming;
  }, [isStreaming]);

  const loadHistory = useCallback(async (isInitial = false) => {
    if (streamingRef.current) return;
    try {
      const res = await fetch("/api/conversations/history?limit=40");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.history)) {
          if (data.history.length > 0) {
            const latest = data.history[data.history.length - 1];
            const sig = String(data.history.length) + "_" + String(latest.timestamp) + "_" + (latest.content || "").substring(0, 30);
            if (isInitial || sig !== lastSignature) {
              setLastSignature(sig);
              setMessages(data.history);
            }
          } else if (isInitial) {
            setMessages([]);
          }
        }
      }
    } catch (err) {
      console.error("Failed to load conversation history:", err);
    }
  }, [lastSignature]);

  useEffect(() => {
    loadHistory(true);
    const interval = setInterval(() => {
      loadHistory(false);
    }, 3500);
    return () => clearInterval(interval);
  }, [user, loadHistory]);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    const authorName = user ? (user.displayName || user.username) : "Guest";
    const optimisticUserMsg: ChatMessage = {
      role: "user",
      content: trimmed,
      author: authorName,
      source: "web",
      timestamp: Date.now()
    };

    setMessages((prev) => [...prev, optimisticUserMsg]);
    setIsStreaming(true);
    setThinkingStatus("Skynet is thinking...");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, stream: true, author: authorName })
      });

      if (!response.body) {
        throw new Error("ReadableStream not supported in this environment");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let assistantText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;

          const jsonStr = line.replace(/^data:\s*/, "");
          if (!jsonStr) continue;

          try {
            const payload: SSEPayload = JSON.parse(jsonStr);

            if (payload.status) {
              setThinkingStatus(payload.status);
            }

            if (payload.token) {
              setThinkingStatus(null);
              assistantText += payload.token;
              setMessages((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last && last.role === "assistant") {
                  copy[copy.length - 1] = { ...last, content: assistantText };
                  return copy;
                } else {
                  return [...copy, {
                    role: "assistant",
                    content: assistantText,
                    author: "Skynet",
                    source: "local",
                    timestamp: Date.now()
                  }];
                }
              });
            }

            if (payload.done && payload.replyContent) {
              setThinkingStatus(null);
              assistantText = payload.replyContent;
              setMessages((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last && last.role === "assistant") {
                  copy[copy.length - 1] = { ...last, content: assistantText };
                  return copy;
                } else {
                  return [...copy, {
                    role: "assistant",
                    content: assistantText,
                    author: "Skynet",
                    source: "local",
                    timestamp: Date.now()
                  }];
                }
              });
            }

            if (payload.error) {
              setThinkingStatus(null);
              setMessages((prev) => [
                ...prev,
                {
                  role: "assistant",
                  content: "Error: " + payload.error,
                  author: "Skynet",
                  source: "local",
                  timestamp: Date.now()
                }
              ]);
            }
          } catch (_) {}
        }
      }
    } catch (err: any) {
      setThinkingStatus(null);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Error: " + (err.message || "Network request failed"),
          author: "Skynet",
          source: "local",
          timestamp: Date.now()
        }
      ]);
    } finally {
      setIsStreaming(false);
      setThinkingStatus(null);
      loadHistory(false);
    }
  };

  return {
    messages,
    isStreaming,
    thinkingStatus,
    sendMessage
  };
}
