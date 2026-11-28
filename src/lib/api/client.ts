
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

export type PaymentResponse = {
  success: true;
  data: {
    paymentId: string;
    amountCents: number;
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

function throwApiError(payload: unknown, response: Response): never {
  const code =
    isApiErrorPayload(payload) && typeof payload.error?.code === "string"
      ? payload.error.code
      : "REQUEST_FAILED";

  throw new ApiClientError(
    "The request could not be completed.",
    response.status,
    code,
  );
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
    throwApiError(payload, response);
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
    throwApiError(payload, response);
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
    throwApiError(payload, response);
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
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          amountCents,
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
    throwApiError(payload, response);
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("success" in payload) ||
    payload.success !== true ||
    !("data" in payload)
  ) {
    throw new ApiClientError(
      "The payment service returned an invalid response.",
      502,
      "INVALID_RESPONSE",
    );
  }

  return payload as PaymentResponse;
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
    throwApiError(payload, response);
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("success" in payload) ||
    payload.success !== true ||
    !("data" in payload)
  ) {
    throw new ApiClientError(
      "The operation receipt is invalid.",
      502,
      "INVALID_RESPONSE",
    );
  }

  return payload as OperationReceiptResponse;
}
