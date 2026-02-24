/**
 * @file tests/components/admin/ReviewApprovalList.test.tsx
 * @description Tests for admin review approval UI component
 * @severity S2 - Critical admin UI with no test coverage
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewApprovalList, type ReviewRow } from "@/components/admin/ReviewApprovalList";

// Mock fetch globally
global.fetch = vi.fn();

const mockToken = "test-admin-token";

const mockPendingReview: ReviewRow = {
  id: "pending-1",
  text: "This is a pending review",
  firstName: "John",
  lastName: "Doe",
  isAnonymous: false,
  verified: true,
  status: "pending",
  createdAt: new Date("2024-01-15T10:00:00Z"),
};

const mockApprovedReview: ReviewRow = {
  id: "approved-1",
  text: "This is an approved review",
  firstName: "Jane",
  lastName: "Smith",
  isAnonymous: false,
  verified: false,
  status: "approved",
  createdAt: new Date("2024-01-10T10:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  (global.fetch as any).mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true }),
  });
});

describe("ReviewApprovalList", () => {
  describe("Initial rendering", () => {
    it("renders pending and approved sections", () => {
      render(
        <ReviewApprovalList
          pending={[mockPendingReview]}
          approved={[mockApprovedReview]}
          token={mockToken}
        />,
      );

      expect(screen.getByText(/Pending/)).toBeTruthy();
      expect(screen.getByText(/Approved/)).toBeTruthy();
    });

    it("displays pending review count", () => {
      render(
        <ReviewApprovalList
          pending={[mockPendingReview, { ...mockPendingReview, id: "pending-2" }]}
          approved={[]}
          token={mockToken}
        />,
      );

      expect(screen.getByText("2")).toBeTruthy();
    });

    it("displays review text", () => {
      render(<ReviewApprovalList pending={[mockPendingReview]} approved={[]} token={mockToken} />);

      expect(screen.getByText("This is a pending review")).toBeTruthy();
    });
  });

  describe("Optimistic UI - Approve action", () => {
    it("calls PATCH API with correct parameters on approve", async () => {
      const user = userEvent.setup();
      render(<ReviewApprovalList pending={[mockPendingReview]} approved={[]} token={mockToken} />);

      const approveButton = screen.getByRole("button", { name: /Approve/i });
      await user.click(approveButton);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith("/api/admin/reviews/pending-1", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "approve", token: mockToken }),
        });
      });
    });
  });

  describe("Optimistic UI - Revoke action", () => {
    it("calls PATCH API with correct parameters on revoke", async () => {
      const user = userEvent.setup();
      render(<ReviewApprovalList pending={[]} approved={[mockApprovedReview]} token={mockToken} />);

      const revokeButton = screen.getByRole("button", { name: /Revoke/i });
      await user.click(revokeButton);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith("/api/admin/reviews/approved-1", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "revoke", token: mockToken }),
        });
      });
    });
  });

  describe("Optimistic UI - Delete action", () => {
    it("calls DELETE API with correct parameters", async () => {
      const user = userEvent.setup();
      render(<ReviewApprovalList pending={[mockPendingReview]} approved={[]} token={mockToken} />);

      const deleteButton = screen.getByRole("button", { name: /Delete/i });
      await user.click(deleteButton);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          `/api/admin/reviews/pending-1?token=${encodeURIComponent(mockToken)}`,
          { method: "DELETE" },
        );
      });
    });
  });
});
