
import { z } from "zod";

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
    message?: unknown;
  };
};

const saleResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    invoice: z.object({
      id: z.string().uuid(),
      number: z.string().regex(/^\d+$/),
    }),
    sale: z.object({
      productId: z.string().uuid(),
      quantity: z.number().int().positive(),
      unitPriceCents: z.number().int().positive(),
      totalCents: z.number().int().positive(),
    }),
  }),
});

export type CreateDriverSaleInput = {
  visitId: string;
  productId: string;
  quantity: number;
  requestKey: string;
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

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ApiClientError(
      "The server returned an invalid response.",
      response.status,
      "INVALID_RESPONSE",
    );
  }
}

function getApiError(
  payload: unknown,
  status: number,
  fallbackMessage: string,
): ApiClientError {
  const error = isApiErrorPayload(payload) ? payload.error : undefined;

  return new ApiClientError(
    typeof error?.message === "string"
      ? error.message
      : fallbackMessage,
    status,
    typeof error?.code === "string" ? error.code : "REQUEST_FAILED",
  );
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

  const payload = await readJson(response);

  if (!response.ok) {
    throw getApiError(
      payload,
      response.status,
      "Assigned visits could not be loaded.",
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

  const payload = await readJson(response);

  if (!response.ok) {
    throw getApiError(
      payload,
      response.status,
      "Van stock could not be loaded.",
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

export async function createDriverSale(
  input: CreateDriverSaleInput,
  fetcher: typeof fetch = fetch,
) {
  let csrfResponse: Response;

  try {
    csrfResponse = await fetcher("/api/csrf", {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new ApiClientError(
      "Could not obtain the security token.",
      0,
      "CSRF_NETWORK_ERROR",
    );
  }

  const csrfPayload = await readJson(csrfResponse);

  if (!csrfResponse.ok) {
    throw getApiError(
      csrfPayload,
      csrfResponse.status,
      "Could not obtain the security token.",
    );
  }

  const csrfToken =
    typeof csrfPayload === "object" &&
    csrfPayload !== null &&
    "token" in csrfPayload &&
    typeof csrfPayload.token === "string"
      ? csrfPayload.token
      : null;

  if (!csrfToken) {
    throw new ApiClientError(
      "The security token was missing.",
      502,
      "CSRF_TOKEN_MISSING",
    );
  }

  let response: Response;

  try {
    response = await fetcher("/api/driver/sales", {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
        "Idempotency-Key": input.requestKey,
      },
      body: JSON.stringify({
        visitId: input.visitId,
        productId: input.productId,
        quantity: input.quantity,
      }),
    });
  } catch {
    throw new ApiClientError(
      "The sale service could not be reached.",
      0,
      "NETWORK_ERROR",
    );
  }

  const payload = await readJson(response);

  if (!response.ok) {
    throw getApiError(
      payload,
      response.status,
      "The sale could not be created.",
    );
  }

  const parsed = saleResponseSchema.safeParse(payload);

  if (!parsed.success) {
    throw new ApiClientError(
      "The sale service returned an invalid response.",
      502,
      "INVALID_RESPONSE",
    );
  }

  return parsed.data;
}
