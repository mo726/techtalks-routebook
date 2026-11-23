import {
  driverVisitsResponseSchema,
  type DriverVisitsResponse,
} from "./contracts/driver-visits";
import {
  driverStockResponseSchema,
  type DriverStockResponse,
} from "./contracts/driver-stock";

type ApiErrorPayload = {
  error?: {
    code?: unknown;
  };
};

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  return typeof value === "object" && value !== null && "error" in value;
}

export async function getDriverVisits(
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<DriverVisitsResponse> {
  let response: Response;
  try {
    response = await fetcher("/api/driver/visits", {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new ApiClientError(
      "The visits service could not be reached.",
      0,
      "NETWORK_ERROR",
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiClientError(
      "The visits service returned an invalid response.",
      response.status,
      "INVALID_RESPONSE",
    );
  }

  if (!response.ok) {
    const code =
      isApiErrorPayload(payload) && typeof payload.error?.code === "string"
        ? payload.error.code
        : "REQUEST_FAILED";
    throw new ApiClientError(
      "Assigned visits could not be loaded.",
      response.status,
      code,
    );
  }

  const parsed = driverVisitsResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiClientError(
      "The visits service returned an invalid response.",
      502,
      "INVALID_RESPONSE",
    );
  }

  return parsed.data;
}

export async function getDriverStock(
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<DriverStockResponse> {
  let response: Response;
  try {
    response = await fetcher("/api/driver/stock", {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new ApiClientError(
      "The stock service could not be reached.",
      0,
      "NETWORK_ERROR",
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiClientError(
      "The stock service returned an invalid response.",
      response.status,
      "INVALID_RESPONSE",
    );
  }

  if (!response.ok) {
    const code =
      isApiErrorPayload(payload) && typeof payload.error?.code === "string"
        ? payload.error.code
        : "REQUEST_FAILED";
    throw new ApiClientError(
      "Van stock could not be loaded.",
      response.status,
      code,
    );
  }

  const parsed = driverStockResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiClientError(
      "The stock service returned an invalid response.",
      502,
      "INVALID_RESPONSE",
    );
  }

  return parsed.data;
}
