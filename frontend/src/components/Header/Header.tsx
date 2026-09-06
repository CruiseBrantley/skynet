
import React from "react";
import styles from "./Header.module.css";
import type { AuthUser, AuthProvider } from "../../types";

interface HeaderProps {
  user: AuthUser | null;
  providers: AuthProvider[];
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({ user, providers, onLogout }) => {
  return (
    <header className={styles.header}>
      <div className={styles.headerContent}>
        <div className={styles.titleGroup}>
          <div className={styles.statusDot} />
          <span className={styles.titleText}>Skynet AI Interface</span>
        </div>
        <div className={styles.authGroup}>
          {user ? (
            <>
              <div className={styles.profileBadge}>
                {user.avatar && (
                  <img src={user.avatar} alt="Avatar" className={styles.userAvatar} />
                )}
                <span>{user.isOwner ? "👑 " : ""}{user.displayName || user.username}</span>
              </div>
              <button className={styles.logoutBtn} onClick={onLogout}>
                Logout
              </button>
            </>
          ) : (
            providers.length > 0 ? (
              providers.map((p) => (
                <a
                  key={p.name}
                  href={"/api/chat/auth/" + p.name + "/login"}
                  className={styles.authBtn + (p.name === "twitch" ? " " + styles.twitchBtn : "")}
                >
                  Login with {p.displayName}
                </a>
              ))
            ) : (
              <span className={styles.profileBadge}>Guest</span>
            )
          )}
        </div>
      </div>
    </header>
  );
};
