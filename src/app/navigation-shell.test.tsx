import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
    "aria-current"?: "page";
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

import { RouteBookShell } from "./navigation-shell";

afterEach(cleanup);

describe("RouteBookShell", () => {
  it("shows supervisor navigation only for the supervisor role", () => {
    render(
      <RouteBookShell role="SUPERVISOR">
        <p>Workspace content</p>
      </RouteBookShell>,
    );

    const navigation = screen.getByRole("navigation", {
      name: "Primary navigation",
    });

    expect(within(navigation).getByRole("link", { name: "Customers" })).toHaveAttribute(
      "href",
      "/supervisor/customers",
    );
    expect(within(navigation).getByRole("link", { name: "Van days" })).toBeInTheDocument();
    expect(within(navigation).getByRole("link", { name: "Reconciliation" })).toBeInTheDocument();
    expect(within(navigation).queryByRole("link", { name: "Assigned visits" })).not.toBeInTheDocument();
    expect(screen.getByText("Workspace content")).toBeInTheDocument();
  });

  it("shows driver navigation only for the driver role", () => {
    render(
      <RouteBookShell role="DRIVER">
        <p>Driver workspace</p>
      </RouteBookShell>,
    );

    const navigation = screen.getByRole("navigation", {
      name: "Primary navigation",
    });

    expect(within(navigation).getByRole("link", { name: "Assigned visits" })).toHaveAttribute(
      "href",
      "/driver/visits",
    );
    expect(within(navigation).getByRole("link", { name: "Van stock" })).toBeInTheDocument();
    expect(within(navigation).queryByRole("link", { name: "Customers" })).not.toBeInTheDocument();
  });

  it("supports opening and closing the responsive navigation", () => {
    render(
      <RouteBookShell role="SUPERVISOR">
        <p>Workspace content</p>
      </RouteBookShell>,
    );

    const openButton = screen.getByRole("button", { name: "Open navigation menu" });
    expect(openButton).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(openButton);
    expect(screen.getByRole("button", { name: "Close navigation menu" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Close navigation menu" }));
    expect(screen.getByRole("button", { name: "Open navigation menu" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});
