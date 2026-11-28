import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Alert,
  Button,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "./index";

afterEach(cleanup);

describe("Button", () => {
  it("supports variants, native props, and submit behavior", () => {
    render(
      <Button type="submit" variant="secondary" size="sm" name="save">
        Save
      </Button>,
    );

    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute(
      "type",
      "submit",
    );
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute(
      "name",
      "save",
    );
  });

  it("shows loading state and prevents duplicate activation", () => {
    render(<Button loading>Saving</Button>);

    expect(screen.getByRole("button", { name: "Saving" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Saving" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });
});

describe("Input", () => {
  it("connects its label and hint to the input", () => {
    render(<Input label="Email" hint="Use your work email." type="email" />);

    const input = screen.getByRole("textbox", { name: "Email" });
    expect(input).toHaveAttribute("type", "email");
    expect(input).toHaveAccessibleDescription("Use your work email.");
  });

  it("exposes validation errors accessibly", () => {
    render(<Input label="Password" error="Password is required." />);

    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Password is required.");
    expect(screen.getByRole("alert")).toHaveTextContent("Password is required.");
  });
});

describe("Alert", () => {
  it("uses an assertive alert role for errors", () => {
    render(<Alert variant="error" title="Save failed">Try again later.</Alert>);

    expect(screen.getByRole("alert")).toHaveTextContent("Save failed");
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
  });

  it("uses a polite status role for informational messages", () => {
    render(<Alert variant="info">No active van day.</Alert>);

    expect(screen.getByRole("status")).toHaveTextContent("No active van day.");
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });
});

describe("loading, error, and empty states", () => {
  it("announces loading status accessibly", () => {
    render(<LoadingState label="Loading customers" />);

    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Loading customers");
  });

  it("renders a retry action for recoverable errors", () => {
    const onRetry = vi.fn();
    render(
      <ErrorState
        message="Could not load customers."
        onRetry={onRetry}
        title="Load failed"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load customers.");
  });

  it("renders an actionable empty state", () => {
    render(
      <EmptyState
        action={<Button>Create customer</Button>}
        description="Add a customer to get started."
        title="No customers yet"
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("No customers yet");
    expect(screen.getByRole("button", { name: "Create customer" })).toBeInTheDocument();
  });
});

describe("Table", () => {
  it("provides responsive table structure with semantic column headers", () => {
    render(
      <Table caption="Customer list">
        <TableHead>
          <TableRow>
            <TableHeaderCell>Name</TableHeaderCell>
            <TableHeaderCell>Location</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell>Cedar Market</TableCell>
            <TableCell>Beirut</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    expect(screen.getByRole("table", { name: "Customer list" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveAttribute(
      "scope",
      "col",
    );
    expect(screen.getByRole("cell", { name: "Cedar Market" })).toBeInTheDocument();
  });
});
