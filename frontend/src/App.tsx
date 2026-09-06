
import React, { useState, useEffect } from "react";
import styles from "./App.module.css";
import { Header } from "./components/Header/Header";
import { ChatContainer } from "./components/ChatContainer/ChatContainer";
import { ChatInput } from "./components/ChatInput/ChatInput";
import { useChat } from "./hooks/useChat";
import type { AuthUser, AuthProvider } from "./types";

export const App: React.FC = () => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [providers, setProviders] = useState<AuthProvider[]>([]);

  useEffect(() => {
    async function fetchAuth() {
      try {
        const [meRes, provRes] = await Promise.all([
          fetch("/api/chat/auth/me"),
          fetch("/api/chat/auth/providers")
        ]);
        const meData = meRes.ok ? await meRes.json() : { authenticated: false };
        const provData = provRes.ok ? await provRes.json() : { providers: [] };

        if (meData.authenticated && meData.user) {
          setUser(meData.user);
        } else {
          setUser(null);
        }

        if (Array.isArray(provData.providers)) {
          setProviders(provData.providers);
        }
      } catch (err) {
        console.error("Auth init failed:", err);
      }
    }
    fetchAuth();
  }, []);

  const handleLogout = async () => {
    try {
      await fetch("/api/chat/auth/logout", { method: "POST" });
      window.location.reload();
    } catch (e) {
      console.error("Logout failed:", e);
    }
  };

  const { messages, isStreaming, thinkingStatus, sendMessage } = useChat(user);

  return (
    <div className={styles.appContainer}>
      <Header user={user} providers={providers} onLogout={handleLogout} />
      <ChatContainer
        messages={messages}
        isStreaming={isStreaming}
        thinkingStatus={thinkingStatus}
      />
      <ChatInput onSend={sendMessage} disabled={isStreaming} />
    </div>
  );
};
