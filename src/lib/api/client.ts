
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

export type PaymentResponse = {
  success: true;
  data: {
    paymentId: string;
    amountCents: string;
    invoiceVersion: number;
    totalPaidCents: string;
    balanceCents: string;
  };
};

export type OperationReceiptResponse = {
  success: true;
  data: {
    requestKey: string;
    methodRoute: string;
    originalStatus: number;
    originalResponse: unknown;
    createdAt: string;
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

async function getCsrfToken(fetcher: typeof fetch): Promise<string> {
  let response: Response;

  try {
    response = await fetcher("/api/csrf", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new ApiClientError(
      "The security token service could not be reached.",
      0,
      "NETWORK_ERROR",
    );
  }

  const payload = await readJson(response);

  if (!response.ok) {
    throw getApiError(payload, response.status, "Could not obtain the security token.");
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("token" in payload) ||
    typeof payload.token !== "string"
  ) {
    throw new ApiClientError(
      "The security token response is invalid.",
      502,
      "INVALID_RESPONSE",
    );
  }

  return payload.token;
}

export async function recordPayment(
  invoiceId: string,
  amountCents: number,
  expectedInvoiceVersion: number,
  requestKey: string,
  fetcher: typeof fetch = fetch,
): Promise<PaymentResponse> {
  const csrfToken = await getCsrfToken(fetcher);
  let response: Response;

  try {
    response = await fetcher(
      `/api/invoices/${encodeURIComponent(invoiceId)}/payments`,
      {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Idempotency-Key": requestKey,
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({
          amountCents: String(amountCents),
          expectedInvoiceVersion,
        }),
      },
    );
  } catch {
    throw new ApiClientError(
      "Payment confirmation could not be received.",
      0,
      "NETWORK_ERROR",
    );
  }

  const payload = await readJson(response);

  if (!response.ok) {
    throw getApiError(payload, response.status, "The payment could not be recorded.");
  }

  const parsed = z
    .object({
      success: z.literal(true),
      data: z.object({
        paymentId: z.string().uuid(),
        amountCents: z.string().regex(/^\d+$/),
        invoiceVersion: z.number().int().positive(),
        totalPaidCents: z.string().regex(/^\d+$/),
        balanceCents: z.string().regex(/^\d+$/),
      }),
    })
    .safeParse(payload);

  if (!parsed.success) {
    throw new ApiClientError(
      "The payment service returned an invalid response.",
      502,
      "INVALID_RESPONSE",
    );
  }

  return parsed.data;
}

export async function getOperationReceipt(
  requestKey: string,
  fetcher: typeof fetch = fetch,
): Promise<OperationReceiptResponse> {
  let response: Response;

  try {
    response = await fetcher(
      `/api/operations/${encodeURIComponent(requestKey)}`,
      {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      },
    );
  } catch {
    throw new ApiClientError(
      "The operation status could not be checked.",
      0,
      "NETWORK_ERROR",
    );
  }

  const payload = await readJson(response);

  if (!response.ok) {
    throw getApiError(payload, response.status, "The operation status could not be checked.");
  }

  const parsed = z
    .object({
      success: z.literal(true),
      data: z.object({
        requestKey: z.string().uuid(),
        methodRoute: z.string(),
        originalStatus: z.number().int(),
        originalResponse: z.unknown(),
        createdAt: z.string(),
      }),
    })
    .safeParse(payload);

  if (!parsed.success) {
    throw new ApiClientError(
      "The operation receipt is invalid.",
      502,
      "INVALID_RESPONSE",
    );
  }

  return parsed.data;
}
