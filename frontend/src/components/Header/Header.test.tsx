
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Header } from "./Header";

describe("Header", () => {
  it("renders Guest badge when unauthenticated without providers", () => {
    render(<Header user={null} providers={[]} onLogout={vi.fn()} />);
    expect(screen.getByText("Guest")).toBeInTheDocument();
    expect(screen.getByText("Skynet AI Interface")).toBeInTheDocument();
  });

  it("renders user avatar and owner crown when logged in as owner", () => {
    const mockUser = {
      id: "199749017150816256",
      provider: "discord",
      providerId: "199749017150816256",
      username: "sirian",
      displayName: "Sirian",
      isOwner: true,
      profileId: "sirian"
    };
    render(<Header user={mockUser} providers={[]} onLogout={vi.fn()} />);
    expect(screen.getByText("👑 Sirian")).toBeInTheDocument();
  });

  it("triggers onLogout when logout button clicked", () => {
    const handleLogout = vi.fn();
    const mockUser = {
      id: "123",
      provider: "discord",
      providerId: "123",
      username: "tester",
      displayName: "Tester",
      profileId: "user_123"
    };
    render(<Header user={mockUser} providers={[]} onLogout={handleLogout} />);
    const btn = screen.getByText("Logout");
    fireEvent.click(btn);
    expect(handleLogout).toHaveBeenCalledOnce();
  });
});
