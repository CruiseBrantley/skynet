export interface AuthUser {
  id: string;
  provider: string;
  providerId: string;
  username: string;
  displayName: string;
  avatar?: string;
  email?: string;
  isOwner?: boolean;
  profileId: string;
}

export interface AuthProvider {
  name: string;
  displayName: string;
  color?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  author?: string;
  source?: 'local' | 'web' | 'discord' | 'cli' | 'dm';
  timestamp?: number;
  discordId?: string;
}

export interface SSEPayload {
  token?: string;
  status?: string;
  done?: boolean;
  replyContent?: string;
  error?: string;
}
